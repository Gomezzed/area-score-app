// =====================================================================
// 校区ヒートマップ PDF のラスタ生成（ブラウザ専用・案B）。
//   別 Image に crossOrigin='anonymous' で OSM タイルを取得し、オフスクリーン
//   Canvas に敷き、校区ポリゴンを画面と同じ style（tierToPathStyle）で描いて
//   1 枚の PNG(data URL) にする。
//   ⛔ ライブ地図の L.tileLayer には触れない（S-12）。ここは独立に Image を生成する。
//   幾何・タイル規則は geometry.ts / tiles.ts（純ロジック）に委譲する。
// =====================================================================

import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { tierToPathStyle } from '@/lib/school-district-map-style'
import { framePx } from './geometry.ts'
import {
  project,
  chooseZoomWithTileCap,
  tileRangeForFrame,
  subdomainFor,
  buildTileUrl,
  type Bounds,
  type LngLat,
} from './tiles.ts'
import { collectPolygonRings, buildMaskPath, type FeatureLike } from './mask-path.ts'
import { OSM_TILE_URL_TEMPLATE, OSM_SUBDOMAINS, OSM_MAX_ZOOM } from './tile-source.ts'

// ポリゴンの properties は突合キー id のみ使う（tier 以外の値は載せない）。
interface DistrictLike {
  id: string
}

export interface RenderInput {
  center: LngLat
  bounds: Bounds
  geojson: FeatureCollection<Geometry, DistrictLike>
  tierById: Map<string, number>
  // 市外を薄くする。既定 false（未指定＝従来どおりマスクなし・後方互換）。
  maskOutside?: boolean
}

export interface RenderResult {
  pngDataUrl: string
  tilesFailed: boolean
}

const TILE_TIMEOUT_MS = 8000
const TILE_CONCURRENCY = 6
const FAILED_TILE_FILL = '#e5e7eb' // slate-200（失敗タイルの薄い灰色）
const BASE_BACKGROUND = '#f8fafc' // slate-50（下地）
const MASK_FILL = 'rgba(255,255,255,0.55)' // 市外を薄くする覆い（合併形の外側）

// crossOrigin 付きで 1 枚読み込む。失敗・タイムアウトは null。
function loadTileImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    let settled = false
    const finish = (r: HTMLImageElement | null) => {
      if (settled) return
      settled = true
      resolve(r)
    }
    const timer = setTimeout(() => finish(null), TILE_TIMEOUT_MS)
    img.onload = () => {
      clearTimeout(timer)
      finish(img)
    }
    img.onerror = () => {
      clearTimeout(timer)
      finish(null)
    }
    img.src = url
  })
}

// 並列度を絞ってワーカーを回す（並列 6）。
async function runPool<I, O>(
  items: I[],
  worker: (item: I) => Promise<O>,
  concurrency: number,
): Promise<O[]> {
  const results = new Array<O>(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++
      results[idx] = await worker(items[idx])
    }
  })
  await Promise.all(runners)
  return results
}

// Polygon / MultiPolygon の座標配列（リング群）を取り出す。
function polygonRingsOf(geom: Geometry): number[][][][] {
  if (geom.type === 'Polygon') return [geom.coordinates as number[][][]]
  if (geom.type === 'MultiPolygon') return geom.coordinates as number[][][][]
  return []
}

// 破線パターン '4 4' → [4,4]。
function parseDash(dashArray: string | undefined): number[] {
  if (!dashArray) return []
  return dashArray
    .split(/[ ,]+/)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
}

export async function renderHeatmapPng(input: RenderInput): Promise<RenderResult> {
  const { width, height } = framePx()
  const z = chooseZoomWithTileCap(input.center, input.bounds, width, height, {
    maxZoom: OSM_MAX_ZOOM,
  })
  const range = tileRangeForFrame(input.center, z, width, height)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context を取得できませんでした')

  // 下地。
  ctx.fillStyle = BASE_BACKGROUND
  ctx.fillRect(0, 0, width, height)

  // ── タイル敷き（並列 6・失敗は灰色で埋めて継続）──
  const jobs: Array<{ x: number; y: number; dx: number; dy: number }> = []
  for (let ty = range.yMin; ty <= range.yMax; ty++) {
    for (let tx = range.xMin; tx <= range.xMax; tx++) {
      jobs.push({
        x: tx,
        y: ty,
        dx: tx * 256 - range.originX,
        dy: ty * 256 - range.originY,
      })
    }
  }

  let tilesFailed = false
  const subdomains = [...OSM_SUBDOMAINS]
  await runPool(
    jobs,
    async (job) => {
      const url = buildTileUrl(OSM_TILE_URL_TEMPLATE, {
        s: subdomainFor(job.x, job.y, subdomains),
        x: job.x,
        y: job.y,
        z,
      })
      const img = await loadTileImage(url)
      if (img) {
        ctx.drawImage(img, job.dx, job.dy, 256, 256)
      } else {
        tilesFailed = true
        ctx.fillStyle = FAILED_TILE_FILL
        ctx.fillRect(job.dx, job.dy, 256, 256)
      }
    },
    TILE_CONCURRENCY,
  )

  // ── 校区ポリゴン（画面と同じ style で描く）──
  const drawFeature = (feature: Feature<Geometry, DistrictLike>) => {
    const id = feature.properties?.id
    const tier = id != null ? input.tierById.get(id) ?? null : null
    const style = tierToPathStyle(tier)
    const rings = polygonRingsOf(feature.geometry)
    if (rings.length === 0) return

    ctx.beginPath()
    for (const polygon of rings) {
      for (const ring of polygon) {
        ring.forEach(([lng, lat], i) => {
          const p = project(lng, lat, z)
          const x = p.x - range.originX
          const y = p.y - range.originY
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.closePath()
      }
    }

    // 塗り（穴を尊重するため even-odd）。fillOpacity は globalAlpha で。
    ctx.save()
    ctx.globalAlpha = style.fillOpacity
    ctx.fillStyle = style.fillColor
    ctx.fill('evenodd')
    ctx.restore()

    // 境界線（実線／破線）。
    ctx.save()
    ctx.globalAlpha = 1
    ctx.strokeStyle = style.color
    ctx.lineWidth = style.weight
    ctx.setLineDash(parseDash(style.dashArray))
    ctx.stroke()
    ctx.restore()
  }

  for (const feature of input.geojson.features) drawFeature(feature)

  // ── 市外を薄くする（maskOutside）──
  //   フレーム矩形＋読み込み済み全 feature の全リングを 1 本の even-odd パスにまとめ、
  //   ctx.fill('evenodd') で合併形の外側だけを白 55% で覆う。
  //   ⛔ tier で feature を絞らない（抑止校区・tier 無しも含む・補足1）。凡例・出典・免責・
  //     ラベルには触れない（描画順はポリゴンの後・タイルの上）。
  if (input.maskOutside) {
    const frameCorners: number[][] = [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ]
    const ringsPx = collectPolygonRings(
      input.geojson.features as unknown as FeatureLike[],
    ).map((ring) =>
      ring.map(([lng, lat]) => {
        const p = project(lng, lat, z)
        return [p.x - range.originX, p.y - range.originY]
      }),
    )
    const maskPath = buildMaskPath(frameCorners, ringsPx)
    const path = new Path2D()
    for (const ring of maskPath.rings) {
      ring.forEach(([x, y], i) => {
        if (i === 0) path.moveTo(x, y)
        else path.lineTo(x, y)
      })
      path.closePath()
    }
    ctx.save()
    ctx.fillStyle = MASK_FILL
    ctx.fill(path, 'evenodd')
    ctx.restore()
  }

  return { pngDataUrl: canvas.toDataURL('image/png'), tilesFailed }
}

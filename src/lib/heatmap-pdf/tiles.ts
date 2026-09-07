// =====================================================================
// 校区ヒートマップ PDF のタイル幾何（純ロジック・依存ゼロ）。
//   Web メルカトル投影（EPSG:3857・Leaflet 既定 CRS 相当）／ズーム選択／
//   フレームに収めるタイル範囲／{s} サブドメイン／URL 組立。
//   ⚠ 外部 import を持たない。定数は引数で注入する。
//   数値・規則の出所は docs/specs/heatmap_pdf_export_v1.md §4。
// =====================================================================

export const TILE_SIZE = 256
export const DEFAULT_MAX_TILES = 150
export const MAX_ZOOM_CAP = 18

export interface LngLat {
  lng: number
  lat: number
}

// 地図の表示範囲（経度・緯度）。
export interface Bounds {
  west: number
  south: number
  east: number
  north: number
}

export interface WorldPoint {
  x: number
  y: number
}

// ズーム z のワールドピクセル寸法（タイル1辺 × 2^z）。
export function worldSize(z: number, tileSize: number = TILE_SIZE): number {
  return tileSize * Math.pow(2, z)
}

// 経度緯度 → ワールドピクセル（Leaflet 既定 EPSG:3857 と同じ式）。
export function project(
  lng: number,
  lat: number,
  z: number,
  tileSize: number = TILE_SIZE,
): WorldPoint {
  const size = worldSize(z, tileSize)
  const x = (size * (lng + 180)) / 360
  const sin = Math.sin((lat * Math.PI) / 180)
  const y = size * (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI))
  return { x, y }
}

// bounds をズーム z で描いたときのピクセル寸法（幅・高さ）。
export function spanPx(
  bounds: Bounds,
  z: number,
  tileSize: number = TILE_SIZE,
): { width: number; height: number } {
  const nw = project(bounds.west, bounds.north, z, tileSize)
  const se = project(bounds.east, bounds.south, z, tileSize)
  return { width: Math.abs(se.x - nw.x), height: Math.abs(se.y - nw.y) }
}

export interface ChooseZoomOptions {
  maxZoom?: number
  minZoom?: number
  tileSize?: number
}

// bounds がフレーム（frameW × frameH px）に収まる最大の整数ズーム z。
//   z が上がるほど span は広がる（単調）ため、収まる最大値を返す。
//   maxZoom は MAX_ZOOM_CAP(=18) でも頭打ちにする。
export function chooseZoom(
  bounds: Bounds,
  frameW: number,
  frameH: number,
  opts: ChooseZoomOptions = {},
): number {
  const minZoom = opts.minZoom ?? 0
  const maxZoom = Math.min(opts.maxZoom ?? MAX_ZOOM_CAP, MAX_ZOOM_CAP)
  const tileSize = opts.tileSize ?? TILE_SIZE
  let best = minZoom
  for (let z = minZoom; z <= maxZoom; z++) {
    const s = spanPx(bounds, z, tileSize)
    if (s.width <= frameW && s.height <= frameH) {
      best = z
    } else {
      break // 単調増加なので、収まらなくなったら打ち切り
    }
  }
  return best
}

export interface TileRange {
  z: number
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  // フレーム左上のワールド px 座標（各タイルの描画オフセット計算に使う）。
  originX: number
  originY: number
}

// 中心を固定してフレームを覆うタイル範囲。フレーム左上のワールド px も返す。
export function tileRangeForFrame(
  center: LngLat,
  z: number,
  frameW: number,
  frameH: number,
  tileSize: number = TILE_SIZE,
): TileRange {
  const c = project(center.lng, center.lat, z, tileSize)
  const left = c.x - frameW / 2
  const top = c.y - frameH / 2
  const right = c.x + frameW / 2
  const bottom = c.y + frameH / 2
  const eps = 1e-6
  return {
    z,
    xMin: Math.floor(left / tileSize),
    xMax: Math.floor((right - eps) / tileSize),
    yMin: Math.floor(top / tileSize),
    yMax: Math.floor((bottom - eps) / tileSize),
    originX: left,
    originY: top,
  }
}

// タイル範囲の枚数。
export function tileCount(range: TileRange): number {
  return (range.xMax - range.xMin + 1) * (range.yMax - range.yMin + 1)
}

// bounds を収める最大 z を選び、タイル上限を超えるなら z を 1 ずつ下げる。
export function chooseZoomWithTileCap(
  center: LngLat,
  bounds: Bounds,
  frameW: number,
  frameH: number,
  opts: ChooseZoomOptions = {},
  maxTiles: number = DEFAULT_MAX_TILES,
): number {
  const minZoom = opts.minZoom ?? 0
  const tileSize = opts.tileSize ?? TILE_SIZE
  let z = chooseZoom(bounds, frameW, frameH, opts)
  while (z > minZoom) {
    const range = tileRangeForFrame(center, z, frameW, frameH, tileSize)
    if (tileCount(range) <= maxTiles) break
    z--
  }
  return z
}

// {s} サブドメイン。Leaflet と同じ (x+y)%len（負値も正へ丸める）。
export function subdomainFor(x: number, y: number, subdomains: string[]): string {
  const idx = (((x + y) % subdomains.length) + subdomains.length) % subdomains.length
  return subdomains[idx]
}

// URL テンプレート組立。{r} は既定で空文字。
export function buildTileUrl(
  template: string,
  params: { s: string; x: number; y: number; z: number; r?: string },
): string {
  return template
    .replace('{s}', params.s)
    .replace('{z}', String(params.z))
    .replace('{x}', String(params.x))
    .replace('{y}', String(params.y))
    .replace('{r}', params.r ?? '')
}

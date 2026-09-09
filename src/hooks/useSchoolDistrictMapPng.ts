'use client'

// =====================================================================
// PR-BM-7: 売主向けシートの学区図パネル用ラスタ生成（ブラウザ専用）。
//   既存の校区ヒートマップ（heatmap-pdf）を流用する。
//   ⛔ src/lib/heatmap-pdf は1行も変更しない（裁定39）。ここは既存の純関数
//     （renderHeatmapPng / boundsFromFeatures / centerOfBounds / padBounds /
//      uniqueAttributions）を呼ぶだけの薄い層。
//   ⚠ renderHeatmapPng はライブ Leaflet 地図に依存しない（center/bounds/geojson/
//     tierById の純入力で PNG を合成する）ため、地図を出さない画面からも呼べる。
//   同じ PNG を画面（<img>）と PDF 1枚目の学区図パネルの双方で使う（二重生成しない）。
//
//   ⛔ tier 以外の値（件数・氏名・住所）は扱わない。tier 自体が k=5 抑止済みで、
//     抑止された校区は「濃淡データ無し」として同じ見え方になる。
//   ⚠ 外接矩形は「読み込んだ全校区」から採る（⛔ tier の有無で feature を
//     絞らない）。絞ると抑止校区の位置が枠の形から推測され得るため。
// =====================================================================

import { useEffect, useState } from 'react'
import type { FeatureCollection, Geometry } from 'geojson'
import { DEFAULT_SCHOOL_TYPE } from '@/lib/school-districts'
import { boundsFromFeatures, centerOfBounds, padBounds } from '@/lib/heatmap-pdf/range'
import type { FeatureLike } from '@/lib/heatmap-pdf/mask-path'
import { uniqueAttributions } from '@/lib/heatmap-pdf/model'

// ポリゴンの properties のうち使う列だけ（突合キー id と出典）。
interface DistrictProps {
  id: string
  attribution_text: string | null
}

// 校区ランキング1行のうち使う列だけ（tier と出典）。件数は返らない設計。
interface RankingRow {
  school_district_id: string
  muni_code_5: string
  tier: number
  attribution_text: string | null
}

export interface SchoolDistrictMapPng {
  pngDataUrl: string
  attributions: string[]
  tilesFailed: boolean
}

export type SchoolDistrictMapState =
  | { status: 'idle' }
  | { status: 'loading'; key: string }
  | { status: 'ready'; key: string; data: SchoolDistrictMapPng }
  | { status: 'empty'; key: string }
  | { status: 'failed'; key: string }

// 外接矩形に足す余白（boundsFromTargetFeatures の既定と同じ 4%）。
const PAD_FRAC = 0.04

// 指定した市区町村の学区図（小学校区）を1枚の PNG に合成する。
//   muniCode5 が null の間は何もしない。
export function useSchoolDistrictMapPng(
  listId: string,
  muniCode5: string | null,
): SchoolDistrictMapState {
  const [state, setState] = useState<SchoolDistrictMapState>({ status: 'idle' })
  const key = muniCode5 ?? ''

  useEffect(() => {
    if (!muniCode5) return
    let alive = true
    ;(async () => {
      try {
        const schoolType = DEFAULT_SCHOOL_TYPE
        const [gr, rr] = await Promise.all([
          fetch(
            `/api/school-districts?muni_code_5=${encodeURIComponent(muniCode5)}&school_type=${encodeURIComponent(schoolType)}`,
          ),
          fetch(
            `/api/customer-lists/${encodeURIComponent(listId)}/school-district-ranking?school_type=${encodeURIComponent(schoolType)}`,
          ),
        ])
        if (!alive) return
        if (!gr.ok) {
          setState({ status: 'failed', key })
          return
        }
        const gj = (await gr.json()) as FeatureCollection<Geometry, DistrictProps>
        const features = Array.isArray(gj?.features) ? gj.features : []
        if (features.length === 0) {
          // この市区町村の学区図が未公開。地図パネルは出さない。
          setState({ status: 'empty', key })
          return
        }

        // 濃淡（tier）。ランキングが取れなくても全校区「濃淡データ無し」で描く。
        let rows: RankingRow[] = []
        if (rr.ok) {
          const rj = (await rr.json()) as { rows?: RankingRow[] }
          rows = (rj.rows ?? []).filter((r) => r.muni_code_5 === muniCode5)
        }
        const tierById = new Map<string, number>(
          rows.map((r) => [r.school_district_id, r.tier]),
        )

        // 外接矩形は全 feature から。⛔ tier で絞らない（抑止校区の露出防止）。
        // FeatureLike は Polygon/MultiPolygon だけを見る最小形（render.ts:221 と同じ
        //   キャストの作法）。GeometryCollection は collectPolygonRings が無視する。
        const raw = boundsFromFeatures(features as unknown as FeatureLike[])
        if (!raw) {
          setState({ status: 'empty', key })
          return
        }
        const bounds = padBounds(raw, PAD_FRAC)
        const center = centerOfBounds(bounds)

        // 合成はクリック時ではなくパネル表示時だが、初期バンドルには乗せない。
        const { renderHeatmapPng } = await import('@/lib/heatmap-pdf/render')
        const { pngDataUrl, tilesFailed } = await renderHeatmapPng({
          center,
          bounds,
          geojson: { type: 'FeatureCollection', features } as FeatureCollection<
            Geometry,
            { id: string }
          >,
          tierById,
          maskOutside: true,
        })
        if (!alive) return

        // 出典は rows → features の順でユニーク化（heatmap-pdf と同じ作法）。
        //   ⛔ 文言を組み立て直さない（DB の attribution_text をそのまま）。
        const attributions = uniqueAttributions([
          ...rows.map((r) => ({ attribution_text: r.attribution_text })),
          ...features.map((f) => ({ attribution_text: f.properties?.attribution_text ?? null })),
        ])
        setState({ status: 'ready', key, data: { pngDataUrl, attributions, tilesFailed } })
      } catch {
        if (alive) setState({ status: 'failed', key })
      }
    })()
    return () => {
      alive = false
    }
  }, [listId, muniCode5, key])

  return state
}

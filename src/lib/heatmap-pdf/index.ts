// =====================================================================
// 校区ヒートマップ PDF 出力の orchestrator（ブラウザ・クリック時に動的 import）。
//   render(PNG) → model(凡例/出典/ファイル名/日時) → document(react-pdf) → download。
//   失敗時は Sentry.withScope でタグ feature=heatmap-pdf を付けて captureException
//   （api-envelope.ts:78 と同じ作法・グローバル setTag 禁止）。
// =====================================================================

import * as Sentry from '@sentry/nextjs'
import type { FeatureCollection, Geometry } from 'geojson'
import { TIER_LABEL, NO_DATA_LEGEND } from '@/lib/school-district-tiers'
import { TIER_FILL, NO_DATA_FILL } from '@/lib/school-district-map-style'
import {
  SCHOOL_DISTRICT_DISCLAIMER,
  SCHOOL_TYPE_LABELS,
  type SchoolType,
} from '@/lib/school-districts'
import { OSM_ATTRIBUTION } from './tile-source.ts'
import { renderHeatmapPng } from './render.ts'
import { HeatmapPdfDocument } from './document.tsx'
import { downloadPdf } from './download.ts'
import {
  buildLegendRows,
  uniqueAttributions,
  buildFileName,
  formatGeneratedAt,
  buildTitle,
  buildMetaTitle,
  type PdfSchoolType,
} from './model.ts'
import type { Bounds, LngLat } from './tiles.ts'

const SITE_LABEL = 'areascore.jp'

export interface ExportHeatmapPdfInput {
  center: LngLat
  bounds: Bounds
  geojson: FeatureCollection<Geometry, { id: string }>
  // 出典（attribution_text）と muni_name のフォールバック元。件数・氏名等は使わない。
  rankRows: Array<{ attribution_text: string | null; muni_name: string }>
  tierById: Map<string, number>
  muniCode5: string
  schoolType: SchoolType
  muniName: string | null
  now?: Date
}

// PDF を生成してダウンロードし、ファイル名を返す。
export async function exportHeatmapPdf(input: ExportHeatmapPdfInput): Promise<string> {
  const now = input.now ?? new Date()
  try {
    // muni_name は画面解決値を優先し、無ければ ranking rows から補完。
    const muniName = input.muniName ?? input.rankRows.find((r) => r.muni_name)?.muni_name ?? ''

    const { pngDataUrl, tilesFailed } = await renderHeatmapPng({
      center: input.center,
      bounds: input.bounds,
      geojson: input.geojson,
      tierById: input.tierById,
    })

    const legend = buildLegendRows(TIER_LABEL, TIER_FILL, NO_DATA_FILL, NO_DATA_LEGEND)
    const attributions = uniqueAttributions(input.rankRows)
    const schoolTypeLabel = SCHOOL_TYPE_LABELS[input.schoolType]
    const fileName = buildFileName(input.muniCode5, input.schoolType as PdfSchoolType, now)

    // Document 要素を直接得る（createElement で包むと DocumentProps 型が失われるため）。
    const element = HeatmapPdfDocument({
      metaTitle: buildMetaTitle(muniName),
      title: buildTitle(muniName, schoolTypeLabel),
      generatedAtLabel: formatGeneratedAt(now),
      pngDataUrl,
      legend,
      attributions,
      disclaimer: SCHOOL_DISTRICT_DISCLAIMER,
      osmAttribution: OSM_ATTRIBUTION,
      siteLabel: SITE_LABEL,
      tilesFailed,
    })

    await downloadPdf(element, fileName)
    return fileName
  } catch (error) {
    Sentry.withScope((scope) => {
      scope.setTag('feature', 'heatmap-pdf')
      Sentry.captureException(error)
    })
    throw error
  }
}

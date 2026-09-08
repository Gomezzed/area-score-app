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
import { HeatmapPdfDocument, HeatmapPdfDocumentBoth } from './document.tsx'
import { downloadPdf } from './download.ts'
import {
  buildLegendRows,
  uniqueAttributions,
  buildFileName,
  formatGeneratedAt,
  buildTitle,
  buildMetaTitle,
  buildFileNameBoth,
  buildTitleBoth,
  buildMetaTitleBoth,
  buildHeatmapPdfBothModel,
  type PdfSchoolType,
} from './model.ts'
import { panelFramePx } from './geometry.ts'
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
  // 市外を薄くする。既定 false（未指定＝従来どおり・後方互換）。
  maskOutside?: boolean
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
      maskOutside: input.maskOutside ?? false,
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

// =====================================================================
// 2パネル（小学校区＋中学校区）出力（PR-C・追加のみ）。
//   左＝小学校区・右＝中学校区で固定。両パネルに同じ bounds/center を適用し、
//   各パネルは panelFramePx() の寸法で renderHeatmapPng を呼ぶ（ズームは両パネル同値）。
//   出典は両校種の rankRows と GeoJSON features の attribution_text を 小→中 の順で
//   ユニーク化して全行印字。免責・OSM 帰属・サイト表記は1パネル時と同じ。
//   既存 exportHeatmapPdf は不変。
// =====================================================================

// 各パネルの入力（その校種の GeoJSON・ランキング rows・突合表）。
export interface HeatmapPdfBothPanelInput {
  geojson: FeatureCollection<Geometry, { id: string; attribution_text?: string | null }>
  // 出典（attribution_text）と muni_name のフォールバック元。件数・氏名等は使わない。
  rankRows: Array<{ attribution_text: string | null; muni_name: string }>
  tierById: Map<string, number>
}

export interface ExportHeatmapPdfBothInput {
  center: LngLat
  bounds: Bounds
  // 左＝小学校区・右＝中学校区で固定。
  elementary: HeatmapPdfBothPanelInput
  juniorHigh: HeatmapPdfBothPanelInput
  muniCode5: string
  muniName: string | null
  now?: Date
  maskOutside?: boolean
}

// 1パネル分の出典源（rows→features の順）を {attribution_text} 配列にする。
function panelAttributionSources(
  panel: HeatmapPdfBothPanelInput,
): Array<{ attribution_text: string | null }> {
  const fromRows = panel.rankRows.map((r) => ({ attribution_text: r.attribution_text }))
  const fromFeatures = panel.geojson.features.map((f) => ({
    attribution_text: f.properties?.attribution_text ?? null,
  }))
  return [...fromRows, ...fromFeatures]
}

// 2パネル PDF を生成してダウンロードし、ファイル名を返す。
export async function exportHeatmapPdfBoth(input: ExportHeatmapPdfBothInput): Promise<string> {
  const now = input.now ?? new Date()
  try {
    const muniName =
      input.muniName ??
      input.elementary.rankRows.find((r) => r.muni_name)?.muni_name ??
      input.juniorHigh.rankRows.find((r) => r.muni_name)?.muni_name ??
      ''

    const panelPx = panelFramePx()
    const maskOutside = input.maskOutside ?? false

    // 各パネルを自校種の features・tierById・同じ bounds/center・パネル px で描く。
    const [leftPng, rightPng] = await Promise.all([
      renderHeatmapPng({
        center: input.center,
        bounds: input.bounds,
        geojson: input.elementary.geojson,
        tierById: input.elementary.tierById,
        maskOutside,
        framePx: panelPx,
      }),
      renderHeatmapPng({
        center: input.center,
        bounds: input.bounds,
        geojson: input.juniorHigh.geojson,
        tierById: input.juniorHigh.tierById,
        maskOutside,
        framePx: panelPx,
      }),
    ])

    const legend = buildLegendRows(TIER_LABEL, TIER_FILL, NO_DATA_FILL, NO_DATA_LEGEND)
    // 出典：小(rows→features)→中(rows→features) の順でユニーク化。
    const attributions = uniqueAttributions([
      ...panelAttributionSources(input.elementary),
      ...panelAttributionSources(input.juniorHigh),
    ])

    const model = buildHeatmapPdfBothModel({
      metaTitle: buildMetaTitleBoth(muniName),
      title: buildTitleBoth(muniName),
      generatedAtLabel: formatGeneratedAt(now),
      left: {
        heading: SCHOOL_TYPE_LABELS.elementary,
        pngDataUrl: leftPng.pngDataUrl,
        tilesFailed: leftPng.tilesFailed,
      },
      right: {
        heading: SCHOOL_TYPE_LABELS.junior_high,
        pngDataUrl: rightPng.pngDataUrl,
        tilesFailed: rightPng.tilesFailed,
      },
      legend,
      attributions,
      disclaimer: SCHOOL_DISTRICT_DISCLAIMER,
      osmAttribution: OSM_ATTRIBUTION,
      siteLabel: SITE_LABEL,
    })

    const element = HeatmapPdfDocumentBoth(model)
    const fileName = buildFileNameBoth(input.muniCode5, now)
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

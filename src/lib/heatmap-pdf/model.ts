// =====================================================================
// 校区ヒートマップ PDF の表示モデル（純ロジック・依存ゼロ）。
//   凡例行の組立／出典のユニーク化／ファイル名／出力日時（JST）／タイトル。
//   ⚠ 外部 import を持たない。色・ラベル等の定数は引数で注入する。
//   ⛔ tier 以外の値（件数・氏名・住所・座標点）をモデルに入れない（S-4）。
//   出所は docs/specs/heatmap_pdf_export_v1.md §8-9。
// =====================================================================

export type PdfSchoolType = 'elementary' | 'junior_high'

// 凡例1行。tier(1..4) は実線・データ無しは破線。件数は持たない。
export interface LegendRow {
  label: string
  color: string
  opacity: number
  dashed: boolean
}

// 凡例5行（tier4→1 ＋ データ無し）。ラベル・色は定数を注入して単一の真実源に合わせる。
//   （画面の凡例＝map/page.tsx Legend と同じ 5 行・同じ色・同じラベル。）
export function buildLegendRows(
  tierLabel: Record<number, string>,
  tierFill: Record<number, string>,
  noDataFill: string,
  noDataLegend: string,
): LegendRow[] {
  const rows: LegendRow[] = [4, 3, 2, 1].map((t) => ({
    label: tierLabel[t],
    color: tierFill[t],
    opacity: 0.6,
    dashed: false,
  }))
  rows.push({ label: noDataLegend, color: noDataFill, opacity: 0.25, dashed: true })
  return rows
}

// 出典（attribution_text）をユニーク化して出現順に返す。空は除く。
export function uniqueAttributions(rows: Array<{ attribution_text: string | null }>): string[] {
  const set = new Set<string>()
  for (const r of rows) {
    if (r.attribution_text) set.add(r.attribution_text)
  }
  return Array.from(set)
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

// JST(UTC+9・DST なし)へ変換して年月日時分を取り出す（純・決定的）。
function toJstParts(d: Date): {
  y: number
  mo: number
  day: number
  h: number
  mi: number
} {
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return {
    y: j.getUTCFullYear(),
    mo: j.getUTCMonth() + 1,
    day: j.getUTCDate(),
    h: j.getUTCHours(),
    mi: j.getUTCMinutes(),
  }
}

// 出力日時（JST・分まで）。例: 2026-09-08 14:30 JST
export function formatGeneratedAt(d: Date): string {
  const p = toJstParts(d)
  return `${p.y}-${pad2(p.mo)}-${pad2(p.day)} ${pad2(p.h)}:${pad2(p.mi)} JST`
}

// ファイル名（ASCII のみ・UUID を含めない・日時は JST）。
//   areascore_heatmap_{muni_code_5}_{elementary|junior_high}_{YYYYMMDD-HHmm}.pdf
export function buildFileName(
  muniCode5: string,
  schoolType: PdfSchoolType,
  d: Date,
): string {
  const p = toJstParts(d)
  const stamp = `${p.y}${pad2(p.mo)}${pad2(p.day)}-${pad2(p.h)}${pad2(p.mi)}`
  return `areascore_heatmap_${muniCode5}_${schoolType}_${stamp}.pdf`
}

// タイトル「校区別の反響の濃さ ― {muni_name}（{校種ラベル}）」。
export function buildTitle(muniName: string, schoolTypeLabel: string): string {
  return `校区別の反響の濃さ ― ${muniName}（${schoolTypeLabel}）`
}

// PDF メタデータ title「校区別の反響の濃さ {muni_name}」。
export function buildMetaTitle(muniName: string): string {
  return `校区別の反響の濃さ ${muniName}`
}

// =====================================================================
// 2パネル（小学校区＋中学校区）用のモデル（追加のみ・PR-C）。
//   既存 build* は不変。both は種別ラベルを固定文言「小学校区＋中学校区」で綴じる。
//   ⛔ tier 以外の値（件数・氏名・住所・座標点）をモデルに入れない（S-4）。
// =====================================================================

// 2パネル固定の校種綴じ文言。左＝小学校区・右＝中学校区。
export const BOTH_PANEL_SUFFIX = '小学校区＋中学校区'

// ファイル名（both）。areascore_heatmap_{muni_code_5}_both_{YYYYMMDD-HHmm}.pdf
export function buildFileNameBoth(muniCode5: string, d: Date): string {
  const p = toJstParts(d)
  const stamp = `${p.y}${pad2(p.mo)}${pad2(p.day)}-${pad2(p.h)}${pad2(p.mi)}`
  return `areascore_heatmap_${muniCode5}_both_${stamp}.pdf`
}

// タイトル（both）「校区別の反響の濃さ ― {muni_name}（小学校区＋中学校区）」。
export function buildTitleBoth(muniName: string): string {
  return `校区別の反響の濃さ ― ${muniName}（${BOTH_PANEL_SUFFIX}）`
}

// PDF メタデータ title（both）「校区別の反響の濃さ {muni_name}（小学校区＋中学校区）」。
export function buildMetaTitleBoth(muniName: string): string {
  return `校区別の反響の濃さ ${muniName}（${BOTH_PANEL_SUFFIX}）`
}

// 2パネル各枠のモデル。tier 以外の値は持てない（heading＝校種ラベル・図＝合成 PNG のみ）。
export interface BothPanelModel {
  heading: string
  pngDataUrl: string
  tilesFailed: boolean
}

// 2パネル PDF の表示モデル（許可キーのみ）。件数・氏名・住所・座標点は持たない。
export interface HeatmapPdfBothModel {
  metaTitle: string
  title: string
  generatedAtLabel: string
  left: BothPanelModel
  right: BothPanelModel
  legend: LegendRow[]
  attributions: string[]
  disclaimer: string
  osmAttribution: string
  siteLabel: string
}

// 許可キー（テストで固定＝S-4 の防波堤）。
export const BOTH_PANEL_MODEL_KEYS = ['heading', 'pngDataUrl', 'tilesFailed'] as const
export const HEATMAP_PDF_BOTH_MODEL_KEYS = [
  'metaTitle',
  'title',
  'generatedAtLabel',
  'left',
  'right',
  'legend',
  'attributions',
  'disclaimer',
  'osmAttribution',
  'siteLabel',
] as const

// モデル組立（許可キーのみを綴じる。余分なキーを混入させない単一の入口）。
export function buildHeatmapPdfBothModel(input: HeatmapPdfBothModel): HeatmapPdfBothModel {
  return {
    metaTitle: input.metaTitle,
    title: input.title,
    generatedAtLabel: input.generatedAtLabel,
    left: {
      heading: input.left.heading,
      pngDataUrl: input.left.pngDataUrl,
      tilesFailed: input.left.tilesFailed,
    },
    right: {
      heading: input.right.heading,
      pngDataUrl: input.right.pngDataUrl,
      tilesFailed: input.right.tilesFailed,
    },
    legend: input.legend,
    attributions: input.attributions,
    disclaimer: input.disclaimer,
    osmAttribution: input.osmAttribution,
    siteLabel: input.siteLabel,
  }
}

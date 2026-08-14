import type { MunicipalityWithStats } from '@/types'

// ============================================================
// エクスポート列定義（CSV / Google Sheets の唯一の出所）。
//   CSV と Sheets が「同じ列・同じ行・同じ値」を出すことを構造的に保証するため、
//   列見出しと各セルの値取得を 1 箇所に集約する。
//
//   重要（回帰防止）：
//     value() が返す生値は、従来 src/lib/csv.ts が直接書いていた式と
//     1:1 で一致させている（null → ''、駅乗降客数 0 → '' 等）。
//     これにより CSV 出力は 1 バイトも変わらない。
//     Sheets 側は数値をそのまま数値セルとして送る（valueInputOption=RAW）。
// ============================================================

// セルの生値。数値列は number のまま保持し、未確定値は '' とする。
export type ExportCell = string | number

// 列描画に必要な文脈（都道府県名など、行データ外の値）。
export interface ExportContext {
  prefectureName: string
}

export interface ExportColumn {
  header: string
  value: (m: MunicipalityWithStats, ctx: ExportContext) => ExportCell
}

// 市区町村エクスポートの列定義（CSV 現行と同一の並び・同一の値式）。
export const MUNICIPALITY_EXPORT_COLUMNS: ExportColumn[] = [
  { header: '都道府県', value: (_m, ctx) => ctx.prefectureName },
  { header: '市区町村', value: (m) => m.name },
  { header: '市区町村コード', value: (m) => m.city_code ?? '' },
  { header: '人口(2025年・速報)', value: (m) => m.popLatest ?? '' },
  { header: '人口(2020年)', value: (m) => m.popPrev ?? '' },
  { header: '人口(2015年)', value: (m) => m.popPrev2 ?? '' },
  { header: '世帯数(2025年・速報)', value: (m) => m.householdsLatest ?? '' },
  { header: '人口増減数(2020→2025)', value: (m) => m.delta ?? '' },
  { header: '人口増減率(%)(2020→2025)', value: (m) => m.deltaRate ?? '' },
  { header: '駅乗降客数合計(最新)', value: (m) => m.stationPassengersTotal || '' },
]

// 見出し行。
export const MUNICIPALITY_EXPORT_HEADERS: string[] =
  MUNICIPALITY_EXPORT_COLUMNS.map((c) => c.header)

// 1 市区町村 → 1 行のセル配列。
export function municipalityExportRow(
  m: MunicipalityWithStats,
  ctx: ExportContext,
): ExportCell[] {
  return MUNICIPALITY_EXPORT_COLUMNS.map((c) => c.value(m, ctx))
}

// 市区町村配列 → 行配列（見出しは含めない）。
export function municipalityExportRows(
  municipalities: MunicipalityWithStats[],
  ctx: ExportContext,
): ExportCell[][] {
  return municipalities.map((m) => municipalityExportRow(m, ctx))
}

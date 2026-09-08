// ============================================================
// 取込サマリのうち「希望条件（BM-2）」の集計 — 依存ゼロの純ロジック。
//
// ⛔ 件数だけを組み立てる（D144/D122）。顧客の生値・個票・未解決トークンそのものは
//    一切含めない。reasons には生値が入りうるため、ここで件数へ畳んでから返す。
//
// ⚠ サマリは DB に保存しない（裁定5）。取込 POST のレスポンス JSON にのみ載せる。
// ============================================================

import { countLeadTypes, type LeadTypeCounts } from './lead-type.ts'
import type { ExtractedRow } from './row-extract.ts'

export interface ImportConditionSummary {
  // 反響区分ごとの行数。
  lead_type: LeadTypeCounts
  // 実際に書き込んだ子行（希望物件種別×価格帯）の件数。
  property_type_rows: number
  // 物件種別として解決できなかった値の件数（買い行の未知トークン＋売り行の未解決）。
  property_type_unknown_tokens: number
  // 書式が合わず値にできなかった価格・面積の件数。
  price_unparsed: number
  area_unparsed: number
}

// reason の接頭辞（唯一の定義。row-extract.ts が積む文字列と対で保つ）。
const UNKNOWN_TYPE_PREFIXES = [
  'property_type:unknown_token:',
  'sell_property_type:unresolved:',
] as const
const PRICE_PREFIX = 'price_'
const AREA_PREFIXES = ['desired_floor_area_', 'desired_land_area_'] as const

// reasons を横断して条件に合う理由の総数を数える（行数ではなく理由の件数）。
function countReasons(
  rows: readonly ExtractedRow[],
  pred: (reason: string) => boolean,
): number {
  return rows.reduce((n, r) => n + r.reasons.filter(pred).length, 0)
}

// 抽出結果と「書き込んだ子行の件数」から希望条件のサマリを作る。
export function summarizeImportConditions(
  extracted: readonly ExtractedRow[],
  propertyTypeRowsWritten: number,
): ImportConditionSummary {
  return {
    lead_type: countLeadTypes(extracted.map((e) => e.lead_type)),
    property_type_rows: propertyTypeRowsWritten,
    property_type_unknown_tokens: countReasons(extracted, (r) =>
      UNKNOWN_TYPE_PREFIXES.some((p) => r.startsWith(p)),
    ),
    price_unparsed: countReasons(
      extracted,
      (r) => r.startsWith(PRICE_PREFIX) && r.endsWith(':unparsed'),
    ),
    area_unparsed: countReasons(extracted, (r) =>
      AREA_PREFIXES.some((p) => r.startsWith(p)),
    ),
  }
}

// ============================================================
// PR-BM-7: 売主向けシートが summary / cells に渡すクエリ文字列の組立（純関数）。
//   ⛔ school_district_id を絶対に付けない（裁定33・案A＝v1 は市区町村のみ）。
//     案B（校区セレクト）を採らない理由：校区ランキング rows は k=5 抑止後の
//     校区しか含まないため、選択肢の有無自体が抑止状態を漏らす。校区単位の
//     絞り込みは、抑止に依存しない校区一覧 API が用意できてから（v1.5）。
//   ⚠ 未指定（null）は「キーを送らない」で表現する。サーバー側の
//     parseBuyerMatchQueryParams は未指定を null とみなし RPC の NULL 規約に
//     委ねるため、空文字を送ると 400（invalid_parameter）になる値がある。
//   ⚠ 外部 import を持たない（node --test で直接読める純モジュール）。
// ============================================================

export interface BuyerMatchQueryInput {
  muniCode5: string | null
  propertyType: string | null
  priceMin: number | null
  priceMax: number | null
}

// クエリ文字列（先頭の '?' は含まない）。値が無いキーは出力しない。
//   価格は整数のみ有効（サーバー側の parsePriceMin/Max と同じ規約）。
//   非整数・負値は「未指定」として落とす（400 を踏まない）。
export function buildBuyerMatchQueryString(input: BuyerMatchQueryInput): string {
  const params = new URLSearchParams()
  if (input.muniCode5) params.set('muni_code_5', input.muniCode5)
  if (input.propertyType) params.set('property_type', input.propertyType)
  if (isValidPrice(input.priceMin)) params.set('price_min', String(input.priceMin))
  if (isValidPrice(input.priceMax)) params.set('price_max', String(input.priceMax))
  return params.toString()
}

// price_min / price_max として送ってよい値か（整数かつ 0 以上）。
export function isValidPrice(v: number | null): v is number {
  return v !== null && Number.isInteger(v) && v >= 0
}

// ============================================================
// A3-1（仮番 -bm-M）: org モードの提示モード（?present=1・裁定86）の URL 補助（純関数）。
//   ⚠ 提示モードは表示の切替であり権限の境界ではない（ゲート・403・RLS とは無関係）。
//   ⛔ list= を付けない（org モード専用・裁定-bm-C）。条件は buildBuyerMatchQueryString
//     を流用する（⛔ 別のクエリ組立を作らない・裁定80）。
// ============================================================

export const BUYER_MATCH_ROUTE = '/customers/buyer-match'

// present=1 のときのみ提示モード（'0'・'true'・''・未指定はすべて false）。
export function isPresentMode(sp: Pick<URLSearchParams, 'get'>): boolean {
  return sp.get('present') === '1'
}

// 「提示する」の遷移先：現在の4条件＋present=1（present はここでのみ・ちょうど1回付ける）。
export function buildPresentHref(conditions: BuyerMatchQueryInput): string {
  return `${BUYER_MATCH_ROUTE}?${buildBuyerMatchQueryString(conditions)}&present=1`
}

// 「編集に戻る」の遷移先：現在の4条件のみ（present を含まない）。
export function buildEditHref(conditions: BuyerMatchQueryInput): string {
  return `${BUYER_MATCH_ROUTE}?${buildBuyerMatchQueryString(conditions)}`
}

// 入力欄（文字列）から価格を読む。空・非整数・負値は null（＝未指定）。
//   ⚠ 全角数字は受けない（NFKC 正規化は取込側の責務であり、ここで別規約を作らない）。
export function parsePriceInput(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  if (!/^\d+$/.test(trimmed)) return null
  const n = Number(trimmed)
  return Number.isSafeInteger(n) ? n : null
}

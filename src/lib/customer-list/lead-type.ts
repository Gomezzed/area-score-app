// ============================================================
// 反響区分（lead_type）の辞書 — 購入希望マッチ（BM）PR-BM-2 / c1。
//   依存ゼロ（React/DB 非依存）の純ロジック。
//
// customer_list_rows.lead_type（BM-1 で作成・CHECK buy/sell/unknown・
//   NOT NULL DEFAULT 'unknown'）に入れる値をここ 1 箇所だけで決める。
//   ⛔ 辞書を他所に複製しない（原則19: 定義は 1 箇所）。
//
// ⛔ O49（キーワード部分一致の誤検出）の再発防止:
//   判定は **NFKC 正規化＋trim 後の完全一致のみ**。前方一致・部分一致・
//   「買」を含むか等の推測を一切行わない。辞書に無い値は必ず 'unknown' に落とし、
//   「たぶん買主だろう」を作らない（原則1: 確定と推定を混ぜない）。
// ============================================================

// 反響区分。DB 側の CHECK 制約（customer_list_rows_lead_type_check）と同じ 3 値。
export type LeadType = 'buy' | 'sell' | 'unknown'

// 『顧客種別』（ハウスドゥ形式 列11・1 始まり）の値 → lead_type の対応表（唯一の定義）。
//   キーは NFKC 正規化＋trim 済みの文字列で持つ（比較側も同じ正規化を通す）。
//
//   ★ '売主' は実 CSV で **未確認の仮置き**。fixture v1（架空・1 行）は '買主' のみで、
//     売り反響の実表記（'売主' なのか '売却' 等なのか）を PM がまだ確認できていない。
//     実表記が判明したらここを直す。⛔ 判明するまで別表記を推測で足さない
//     （足すと未確認の推定が確定値として DB に入る）。
const LEAD_TYPE_DICT: Readonly<Record<string, LeadType>> = {
  買主: 'buy',
  売主: 'sell', // ★ 仮置き（実 CSV 未確認）
}

// 文字列を辞書の比較キーに揃える（NFKC 正規化 → 前後の空白除去）。
//   NFKC で全角英数・互換文字の揺れを吸収する（ヘッダ解決 presets.ts と同じ流儀）。
function normalizeKey(raw: string | null | undefined): string {
  return (raw ?? '').normalize('NFKC').trim()
}

// 『顧客種別』の生値から lead_type を決める。
//   - 辞書に完全一致 → 対応する 'buy' / 'sell'
//   - 空・null・undefined・空白のみ → 'unknown'
//   - 辞書に無い値（'法人'・'買主希望' 等）→ 'unknown'（⛔ 部分一致で拾わない）
export function toLeadType(rawCategory: string | null | undefined): LeadType {
  const key = normalizeKey(rawCategory)
  if (key === '') return 'unknown'
  return LEAD_TYPE_DICT[key] ?? 'unknown'
}

// 反響区分ごとの件数（取込サマリ用）。⛔ 個票・生値は持たない（D144・D122）。
export interface LeadTypeCounts {
  buy: number
  sell: number
  unknown: number
}

// lead_type の配列を件数に畳む（サマリの lead_type キーに載せる形）。
export function countLeadTypes(types: readonly LeadType[]): LeadTypeCounts {
  const counts: LeadTypeCounts = { buy: 0, sell: 0, unknown: 0 }
  for (const t of types) counts[t]++
  return counts
}

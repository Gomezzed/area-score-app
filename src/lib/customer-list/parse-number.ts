// ============================================================
// 希望条件の数値パーサ（価格＝万円 / 面積＝㎡）— 購入希望マッチ（BM）PR-BM-2 / c2。
//   依存ゼロ（React/DB 非依存）の純ロジック。
//
// 原則1（確定と推定を混ぜない）をパーサの設計に落としたもの:
//   受け付けるのは **完全一致の書式だけ**。少しでも解釈が要る値は値を作らず
//   null にし、呼び出し側が reasons に '<field>:unparsed' を残す。
//   ⛔ 坪→㎡ の換算をしない（換算＝推定を確定値の列に入れることになる）。
//   ⛔ 範囲表記（'3000〜4000'）から片側を拾わない。
//   ⛔ 小数を四捨五入しない（DB 側は integer。丸め＝元値と違う確定値を作る）。
//
// 受け付ける書式（NFKC 正規化＋trim の後）:
//   - 数字のみ                        例: '3000'  '0'
//   - 3 桁区切りのカンマ付き           例: '3,000'  '12,345,678'
//   - 価格の接尾辞 '万円' / '万'       例: '3000万円'  '3,000万'
//   - 面積の接尾辞 '㎡' / 'm2' / 'm²'  例: '85㎡'  '85m2'（NFKC で 3 つとも 'm2' に揃う）
//   ※ 全角数字・全角カンマ・互換文字は NFKC で吸収される（'３０００' → '3000'）。
//
// 受け付けない書式（すべて unparsed）:
//   '30坪' / '3000〜4000' / '約3000' / '3000万円以下' / '80.5' / '-10' / '+10' /
//   '3,00'（桁区切りが不正）/ 'なし' / PostgreSQL の integer 範囲を超える値。
// ============================================================

// パース結果。値と「解釈できなかったか」を分けて返す。
//   - 未入力（空文字・null）  … { value: null, unparsed: false } ＝ 理由を残さない
//   - 解釈できない書式        … { value: null, unparsed: true  } ＝ 呼び出し側が reason を残す
//   - 解釈できた              … { value: <整数>, unparsed: false }
export interface ParsedNumber {
  value: number | null
  unparsed: boolean
}

const EMPTY: ParsedNumber = { value: null, unparsed: false }
const UNPARSED: ParsedNumber = { value: null, unparsed: true }

// PostgreSQL の integer（int4）上限。これを超える値は DB へ入れられないため
//   黙って切り詰めず unparsed にする（列の型と辞書の許容範囲を一致させる）。
const MAX_INT4 = 2147483647

// 数字のみ、または 3 桁区切りのカンマ付き（先頭グループは 1〜3 桁）。
//   ⛔ '3,00' や '1,2345' のような不正な区切りは一致しない（曖昧な値を通さない）。
const DIGITS = /^(?:\d+|\d{1,3}(?:,\d{3})+)$/

// 比較用に正規化する（NFKC → trim）。'㎡'→'m2'、'²'→'2'、'，'→','、全角数字→半角。
function normalize(raw: string | null | undefined): string {
  return (raw ?? '').normalize('NFKC').trim()
}

// 正規化済みの本体（接尾辞を除いた部分）を整数にする。
function toInteger(body: string): ParsedNumber {
  if (!DIGITS.test(body)) return UNPARSED
  const n = Number(body.replace(/,/g, ''))
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_INT4) return UNPARSED
  return { value: n, unparsed: false }
}

// 末尾の接尾辞を 1 つだけ取り除く（候補は長い順に試す）。付いていなくてよい。
function stripSuffix(s: string, suffixes: readonly string[]): string {
  for (const suf of suffixes) {
    if (s.endsWith(suf)) return s.slice(0, -suf.length).trim()
  }
  return s
}

// 価格（万円・整数）。'3000' / '3,000万円' / '3000万' を受け付ける。
//   ⛔ 円単位への換算はしない（値はあくまで CSV 記載の万円）。
export function parsePriceManyen(raw: string | null | undefined): ParsedNumber {
  const s = normalize(raw)
  if (s === '') return EMPTY
  return toInteger(stripSuffix(s, ['万円', '万']))
}

// 面積（㎡・整数）。'85' / '85㎡' / '85m2' / '85m²' を受け付ける。
//   ⚠ NFKC 後は '㎡' も 'm²' も 'm2' になるため、接尾辞の候補は 'm2' の 1 つで足りる
//     （元表記のどれで書かれていても同じ経路を通る）。
//   ⛔ 坪は受け付けない（換算＝推定を混ぜない）。'30坪' は unparsed。
export function parseAreaSqm(raw: string | null | undefined): ParsedNumber {
  const s = normalize(raw)
  if (s === '') return EMPTY
  return toInteger(stripSuffix(s, ['m2']))
}

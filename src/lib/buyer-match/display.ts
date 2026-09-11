// ============================================================
// PR-BM-7: 売主向けシートの表示ゲート（純ロジック・裁定38）。
//   画面（BuyerMatchPanel）と PDF（seller-sheet）が同じ判定を通るように、
//   「k 抑止をどう表示に反映するか」「セルを n 降順で6件に絞り、7件目以降を
//   『ほか』にするか」をここ1箇所に置く。node --test で網羅する。
//
//   ⛔ suppressed_* が true のとき数値を1つも作らない（value は必ず null）。
//     RPC は抑止時に count を null ではなく 0 で返すため、「0 かどうか」で
//     判定してはならない（0名という嘘の数字になる）。判定は必ず suppressed_*。
//   ⛔ セルの n を合算して総数にしない。1行が複数の価格バケットに現れるため、
//     合算は実人数と一致しない。総数は summary の wide_count/near_count のみ。
//   ⛔ 7件目以降は件数を出さず 'ほか' とだけ書く（裁定34）。
//   ⚠ 外部 import は同ディレクトリの純モジュールのみ（node --test は '@/' を
//     解決できないため相対 import・拡張子付き）。
// ============================================================

import { BUYER_MATCH_MESSAGES, BUYER_MATCH_CARDS_MESSAGES } from './messages.ts'
import type {
  BuyerMatchCard,
  BuyerMatchCards,
  BuyerMatchCell,
  BuyerMatchSummary,
  BuyerMatchUsedConditions,
} from './types.ts'

// 内訳カードの最大表示数（2行3列＝PDF 2枚目のレイアウトと同数）。
export const MAX_CELLS = 6

// 価格・広さのバケット見出し。⚠ 裁定34 の逐語文言ではない（バケットの体裁）。
export const NO_PRICE_BUCKET_LABEL = '価格の希望なし'
export const NO_AREA_BUCKET_LABEL = '広さの希望なし'

// 大きな数字1つ分。suppressed のとき value は必ず null・message に代替文言が入る。
export interface CountDisplay {
  heading: string
  suppressed: boolean
  value: number | null
  message: string | null
}

export interface CountDisplays {
  wide: CountDisplay
  near: CountDisplay
}

// 裁定29: suppressed_wide → wide の数字を出さない。suppressed_near → near だけ
//   伏せ、wide は出してよい。両者は独立に判定する（near ⊆ wide のため、wide が
//   抑止なら near も必ず抑止されるが、その含意に依存せず各フラグを見る）。
export function buildCountDisplays(summary: BuyerMatchSummary): CountDisplays {
  return {
    wide: {
      heading: BUYER_MATCH_MESSAGES.wideHeading,
      suppressed: summary.suppressed_wide,
      value: summary.suppressed_wide ? null : summary.wide_count,
      message: summary.suppressed_wide ? BUYER_MATCH_MESSAGES.suppressedWide : null,
    },
    near: {
      heading: BUYER_MATCH_MESSAGES.nearHeading,
      suppressed: summary.suppressed_near,
      value: summary.suppressed_near ? null : summary.near_count,
      message: summary.suppressed_near ? BUYER_MATCH_MESSAGES.suppressedNear : null,
    },
  }
}

export interface CellsDisplay {
  // n の降順・最大 MAX_CELLS 件。同数のときは RPC の並び（sort_order→価格→広さ）のまま。
  cells: BuyerMatchCell[]
  // 7件目以降があるか。⛔ 残り件数は持たない（'ほか' としか書かないため）。
  hasMore: boolean
  overflowLabel: string | null
  // 0件のときの文言。0件でないときは null。
  emptyMessage: string | null
}

// cells は RPC の並び（sort_order, price, area）で来る。n の降順に並べ替えて
//   上位 MAX_CELLS 件だけ返す。sort は安定なので同数は元の並びを保つ。
export function buildCellsDisplay(cells: BuyerMatchCell[]): CellsDisplay {
  if (cells.length === 0) {
    return {
      cells: [],
      hasMore: false,
      overflowLabel: null,
      emptyMessage: BUYER_MATCH_MESSAGES.cellsEmpty,
    }
  }
  const sorted = [...cells].sort((a, b) => b.n - a.n)
  const hasMore = sorted.length > MAX_CELLS
  return {
    cells: sorted.slice(0, MAX_CELLS),
    hasMore,
    overflowLabel: hasMore ? BUYER_MATCH_MESSAGES.cellsOverflow : null,
    emptyMessage: null,
  }
}

function fmtInt(n: number): string {
  return n.toLocaleString('ja-JP')
}

// 価格帯（半開区間 [min, max) の万円）。両方 null は「価格の希望なし」枠。
export function formatPriceBucket(min: number | null, max: number | null): string {
  if (min === null || max === null) return NO_PRICE_BUCKET_LABEL
  return `${fmtInt(min)}〜${fmtInt(max)}万円`
}

// 広さ帯（[min, max) の㎡）。両方 null は「広さの希望なし」枠。
export function formatAreaBucket(min: number | null, max: number | null): string {
  if (min === null || max === null) return NO_AREA_BUCKET_LABEL
  return `${fmtInt(min)}〜${fmtInt(max)}㎡`
}

// 内訳カードの見出し「<label_ja> / <価格帯> / <広さ帯>」。
export function formatCellTitle(cell: BuyerMatchCell): string {
  return [
    cell.label_ja,
    formatPriceBucket(cell.price_bucket_min, cell.price_bucket_max),
    formatAreaBucket(cell.floor_area_bucket_min, cell.floor_area_bucket_max),
  ].join(' / ')
}

// 内訳カードの人数「n名」。⛔ 合算しない（呼び出し側でも足さない）。
export function formatCellCount(cell: BuyerMatchCell): string {
  return `${fmtInt(cell.n)}名`
}

// 大きな数字の表示「n名」。suppressed のときは呼ばない（value が null）。
export function formatCountValue(value: number): string {
  return `${fmtInt(value)}名`
}

// ============================================================
// PR-BM-9b-2: 匿名カード（cards）の表示ロジック（裁定71〜76）。
//   ⚠ ここも純関数のみ。画面（buyer-match/page.tsx）とボタン（BuyerMatchPanel）が
//     同じ判定・整形を通す。node --test で網羅する（display-cards.test.ts）。
//   ⛔ 画面に出してはならない内部値（stage 数値・k・max_cards）を返り値に混ぜない。
// ============================================================

// 裁定71: opt_in=false ならボタンを描かない（⛔ 案内文も出さない）。
//   売主向けシートはこの1関数の真偽だけでボタンの有無を決める。
export function shouldShowBuyerCardsButton(cards: BuyerMatchCards): boolean {
  return cards.opt_in === true
}

// 裁定72: suppressed=true または stage=null のときはカード領域ごと出さない。
//   ⛔ cards.length === 0 で判定しない（裁定38 の再演）。必ず suppressed / stage を見る。
//   （RPC は抑止時にも cards を空で返すため、length では抑止と 0 件を区別できない。）
export function shouldShowBuyerCards(cards: BuyerMatchCards): boolean {
  return !cards.suppressed && cards.stage !== null
}

// テンプレート（messages）へプレースホルダを流し込む最小の補間。未知キーは空へ。
function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '')
}

// 裁定73: 見出しは used_conditions から組む（⛔ 呼び出し時の条件ではない）。
//   段の分岐は used_conditions の「どのフィールドが非 null か」だけで決める
//   （⛔ stage 数値には依存しない・「段2」等の内部用語も出さない）。
//   種別名（property_type→label_ja）と市区町村名（muni_code_5→muni_name）は
//   呼び出し側で解決して渡す。null は「指定なし」。
export function buildBuyerCardsHeading(
  used: BuyerMatchUsedConditions,
  propertyTypeLabel: string | null,
  muniName: string | null,
): string {
  const M = BUYER_MATCH_CARDS_MESSAGES
  const type = propertyTypeLabel ?? M.valueNone
  // 種別を外した段（段4）：市区町村名で組む。
  if (used.property_type === null) {
    return fillTemplate(M.headingMuniOnly, { muni: muniName ?? M.valueNone })
  }
  const hasMin = used.price_min !== null
  const hasMax = used.price_max !== null
  if (hasMin && hasMax) {
    return fillTemplate(M.headingPriceRange, {
      min: fmtInt(used.price_min as number),
      max: fmtInt(used.price_max as number),
      type,
    })
  }
  if (hasMax) {
    return fillTemplate(M.headingPriceMax, { max: fmtInt(used.price_max as number), type })
  }
  if (hasMin) {
    return fillTemplate(M.headingPriceMin, { min: fmtInt(used.price_min as number), type })
  }
  // 価格が両方 null（段3）：種別のみ。
  return fillTemplate(M.headingTypeOnly, { type })
}

// カードのバッジ（裁定76: property_types の先頭を label_ja で表示）。
//   ⛔ 解決できない code をそのまま画面に出さない（裁定35）→「指定なし」。
export function resolveCardBadgeLabel(
  propertyTypes: string[],
  labelByCode: Record<string, string>,
): string {
  const first = propertyTypes[0]
  if (!first) return BUYER_MATCH_CARDS_MESSAGES.valueNone
  return labelByCode[first] ?? BUYER_MATCH_CARDS_MESSAGES.valueNone
}

// 希望予算行を出すか（裁定81: 両方 null なら行ごと出さない）。片側でも値があれば出す。
//   ⚠ カードの price_min/price_max は「購入検討者本人の希望予算」であり、見出しの価格
//     （売主の検索条件）とは別物（裁定81）。
export function hasPriceRow(min: number | null, max: number | null): boolean {
  return min !== null || max !== null
}

// 希望予算の表示「{min}〜{max}万円」（3桁区切り）。片側のみは「〜{max}万円」「{min}万円〜」。
//   両方 null は「指定なし」（呼び出し側は hasPriceRow で行ごと落とすのが原則）。
//   ⚠ formatCardArea のコピーではない（単位が万円・裁定81）。整形分岐が同型であることは
//     display-cards.test.ts で担保する。
export function formatCardPrice(min: number | null, max: number | null): string {
  const M = BUYER_MATCH_CARDS_MESSAGES
  if (min === null && max === null) return M.valueNone
  if (min !== null && max !== null) return `${fmtInt(min)}〜${fmtInt(max)}万円`
  if (max !== null) return `〜${fmtInt(max)}万円`
  return `${fmtInt(min as number)}万円〜`
}

// 面積行を出すか（裁定76: 両方 null なら行ごと出さない）。片側でも値があれば出す。
export function hasAreaRow(min: number | null, max: number | null): boolean {
  return min !== null || max !== null
}

// 面積の表示「{min}〜{max}㎡」（3桁区切り）。片側のみは「〜{max}㎡」「{min}㎡〜」。
//   両方 null は「指定なし」（呼び出し側は hasAreaRow で行ごと落とすのが原則）。
export function formatCardArea(min: number | null, max: number | null): string {
  const M = BUYER_MATCH_CARDS_MESSAGES
  if (min === null && max === null) return M.valueNone
  if (min !== null && max !== null) return `${fmtInt(min)}〜${fmtInt(max)}㎡`
  if (max !== null) return `〜${fmtInt(max)}㎡`
  return `${fmtInt(min as number)}㎡〜`
}

// 校区行を出すか（裁定76: desired_districts が空配列なら校区の行を出さない）。
export function hasDistrictsRow(card: BuyerMatchCard): boolean {
  return card.desired_districts.length > 0
}

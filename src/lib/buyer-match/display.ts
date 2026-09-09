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

import { BUYER_MATCH_MESSAGES } from './messages.ts'
import type { BuyerMatchCell, BuyerMatchSummary } from './types.ts'

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

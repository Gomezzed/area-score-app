// =====================================================================
// PR-BM-7 c6: 表示ゲート（display.ts）の単体テスト（裁定38）。
//   ⚠ node --test は '@/' エイリアスを解決できないため相対 import・拡張子付き。
//   ローカルでは FEATURE_BUYER_MATCH が off で実データ表示を確認できない（S-5）。
//   抑止ゲートの正しさはここで担保する。
// =====================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_CELLS,
  buildCellsDisplay,
  buildCountDisplays,
  formatAreaBucket,
  formatCellCount,
  formatCellTitle,
  formatCountValue,
  formatPriceBucket,
} from './display.ts'
import { BUYER_MATCH_MESSAGES } from './messages.ts'
import type { BuyerMatchCell, BuyerMatchSummary } from './types.ts'

function summary(over: Partial<BuyerMatchSummary> = {}): BuyerMatchSummary {
  return {
    wide_count: 128,
    near_count: 6,
    suppressed_wide: false,
    suppressed_near: false,
    k: 5,
    ...over,
  }
}

function cell(over: Partial<BuyerMatchCell> = {}): BuyerMatchCell {
  return {
    property_type: 'used_condo',
    label_ja: '中古マンション',
    price_bucket_min: 2000,
    price_bucket_max: 2500,
    floor_area_bucket_min: 60,
    floor_area_bucket_max: 80,
    n: 5,
    ...over,
  }
}

// --- 抑止ゲート（裁定29） ------------------------------------------------

test('抑止なし: wide/near とも数値が出る', () => {
  const d = buildCountDisplays(summary())
  assert.equal(d.wide.suppressed, false)
  assert.equal(d.wide.value, 128)
  assert.equal(d.wide.message, null)
  assert.equal(d.near.value, 6)
  assert.equal(d.near.message, null)
})

test('suppressed_wide=true のとき wide の数値を1つも作らない', () => {
  // ★RPC は抑止時に count を null ではなく 0 で返す。0 をそのまま出すと
  //   「0名」という嘘の数字になるため、value は必ず null でなければならない。
  const d = buildCountDisplays(
    summary({ wide_count: 0, near_count: 0, suppressed_wide: true, suppressed_near: true }),
  )
  assert.equal(d.wide.value, null)
  assert.notEqual(d.wide.value, 0)
  assert.equal(d.wide.message, BUYER_MATCH_MESSAGES.suppressedWide)
  assert.equal(d.near.value, null)
  assert.equal(d.near.message, BUYER_MATCH_MESSAGES.suppressedNear)
})

test('suppressed_near=true のときは near だけ伏せ、wide は出す（裁定29）', () => {
  const d = buildCountDisplays(
    summary({ wide_count: 128, near_count: 0, suppressed_near: true }),
  )
  assert.equal(d.wide.value, 128)
  assert.equal(d.wide.message, null)
  assert.equal(d.near.value, null)
  assert.notEqual(d.near.value, 0)
  assert.equal(d.near.message, BUYER_MATCH_MESSAGES.suppressedNear)
})

test('見出しは裁定34 の逐語定数をそのまま使う', () => {
  const d = buildCountDisplays(summary())
  assert.equal(d.wide.heading, BUYER_MATCH_MESSAGES.wideHeading)
  assert.equal(d.near.heading, BUYER_MATCH_MESSAGES.nearHeading)
})

// --- 内訳カード（裁定34） ------------------------------------------------

test('cells が0件のとき裁定34 の文言を返し、カードは1枚も作らない', () => {
  const v = buildCellsDisplay([])
  assert.equal(v.cells.length, 0)
  assert.equal(v.hasMore, false)
  assert.equal(v.overflowLabel, null)
  assert.equal(v.emptyMessage, BUYER_MATCH_MESSAGES.cellsEmpty)
})

test('n の降順に並べ替える（RPC は sort_order 順で来る）', () => {
  const v = buildCellsDisplay([cell({ n: 5 }), cell({ n: 21 }), cell({ n: 9 })])
  assert.deepEqual(
    v.cells.map((c) => c.n),
    [21, 9, 5],
  )
  assert.equal(v.emptyMessage, null)
})

test('同数のセルは RPC の並びを保つ（安定ソート）', () => {
  const v = buildCellsDisplay([
    cell({ property_type: 'a', n: 7 }),
    cell({ property_type: 'b', n: 7 }),
    cell({ property_type: 'c', n: 9 }),
  ])
  assert.deepEqual(
    v.cells.map((c) => c.property_type),
    ['c', 'a', 'b'],
  )
})

test('6件ちょうどなら "ほか" を出さない', () => {
  const v = buildCellsDisplay(Array.from({ length: 6 }, (_, i) => cell({ n: 10 + i })))
  assert.equal(v.cells.length, 6)
  assert.equal(v.hasMore, false)
  assert.equal(v.overflowLabel, null)
})

test('7件以上のとき上位6件だけ出し、7件目以降は "ほか" のみ（⛔ 件数を出さない）', () => {
  const v = buildCellsDisplay(Array.from({ length: 9 }, (_, i) => cell({ n: 100 - i })))
  assert.equal(v.cells.length, MAX_CELLS)
  assert.equal(v.cells.length, 6)
  assert.equal(v.hasMore, true)
  assert.equal(v.overflowLabel, BUYER_MATCH_MESSAGES.cellsOverflow)
  assert.equal(v.overflowLabel, 'ほか')
  // ★残り件数（3・9・7 など）が文言に混ざっていないこと。
  assert.equal(/\d/.test(v.overflowLabel ?? ''), false)
  // ★CellsDisplay は残り件数を持たない（合算・残数の露出経路を型ごと作らない）。
  assert.equal(Object.prototype.hasOwnProperty.call(v, 'remaining'), false)
})

test('上位6件は元配列の n 上位6件と一致する', () => {
  const cells = [5, 30, 12, 8, 40, 6, 25, 7].map((n) => cell({ n }))
  const v = buildCellsDisplay(cells)
  assert.deepEqual(
    v.cells.map((c) => c.n),
    [40, 30, 25, 12, 8, 7],
  )
})

test('buildCellsDisplay は入力配列を破壊しない', () => {
  const cells = [cell({ n: 5 }), cell({ n: 30 })]
  buildCellsDisplay(cells)
  assert.deepEqual(
    cells.map((c) => c.n),
    [5, 30],
  )
})

// --- 体裁 ---------------------------------------------------------------

test('価格帯・広さ帯は半開区間で表記し、両端 null は別枠の文言にする', () => {
  assert.equal(formatPriceBucket(2000, 2500), '2,000〜2,500万円')
  assert.equal(formatPriceBucket(null, null), '価格の希望なし')
  assert.equal(formatPriceBucket(null, 2500), '価格の希望なし')
  assert.equal(formatAreaBucket(60, 80), '60〜80㎡')
  assert.equal(formatAreaBucket(null, null), '広さの希望なし')
})

test('内訳カードの見出しは「種別 / 価格帯 / 広さ帯」', () => {
  assert.equal(formatCellTitle(cell()), '中古マンション / 2,000〜2,500万円 / 60〜80㎡')
  assert.equal(formatCellCount(cell({ n: 12 })), '12名')
  assert.equal(formatCountValue(1234), '1,234名')
})

// ---------------------------------------------------------------------
// PR-BM-10c: org モードの表示補助（formatConditionSummary / formatAreaLabel）。
//   ⚠ 価格整形は formatCardPrice の再利用を前提に、片側のみ・価格なしを網羅する。
// ---------------------------------------------------------------------
import { formatConditionSummary, formatAreaLabel } from './display.ts'

test('条件要約は「市区町村 / 種別 / 価格帯」を / で連結する', () => {
  assert.equal(
    formatConditionSummary({
      muniName: '岡崎市',
      propertyTypeLabel: '中古戸建',
      priceMin: 2000,
      priceMax: 4000,
    }),
    '岡崎市 / 中古戸建 / 2,000〜4,000万円',
  )
})

test('条件要約: 価格が片側のみは formatCardPrice に委ねる', () => {
  assert.equal(
    formatConditionSummary({ muniName: '岡崎市', propertyTypeLabel: '中古戸建', priceMin: null, priceMax: 4000 }),
    '岡崎市 / 中古戸建 / 〜4,000万円',
  )
  assert.equal(
    formatConditionSummary({ muniName: '岡崎市', propertyTypeLabel: '中古戸建', priceMin: 2000, priceMax: null }),
    '岡崎市 / 中古戸建 / 2,000万円〜',
  )
})

test('条件要約: 価格が両方 null なら価格セグメントを出さない', () => {
  assert.equal(
    formatConditionSummary({ muniName: '岡崎市', propertyTypeLabel: '中古戸建', priceMin: null, priceMax: null }),
    '岡崎市 / 中古戸建',
  )
})

test('条件要約: 市区町村名・種別名が null なら「指定なし」に写す', () => {
  assert.equal(
    formatConditionSummary({ muniName: null, propertyTypeLabel: null, priceMin: null, priceMax: null }),
    '指定なし / 指定なし',
  )
})

test('市区町村ラベルは都道府県があれば前置きする', () => {
  assert.equal(formatAreaLabel({ prefecture_name: '愛知県', muni_name: '岡崎市' }), '愛知県 岡崎市')
  assert.equal(formatAreaLabel({ prefecture_name: null, muni_name: '岡崎市' }), '岡崎市')
})

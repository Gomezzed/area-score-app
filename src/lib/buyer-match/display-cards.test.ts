// =====================================================================
// PR-BM-9b-2: 匿名カードの表示ロジック（display.ts）の単体テスト（裁定71〜76）。
//   ⚠ node --test は '@/' を解決できないため相対 import・拡張子付き。
//   ローカルでは FEATURE_BUYER_MATCH が off で実データ表示を確認できない（S-5）。
//   ボタン出し分け・抑止判定・見出し組立・面積整形の正しさはここで担保する。
// =====================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildBuyerCardsHeading,
  formatCardArea,
  formatCardPrice,
  hasAreaRow,
  hasDistrictsRow,
  hasPriceRow,
  resolveCardBadgeLabel,
  shouldShowBuyerCards,
  shouldShowBuyerCardsButton,
} from './display.ts'
import { BUYER_MATCH_CARDS_MESSAGES } from './messages.ts'
import type {
  BuyerMatchCard,
  BuyerMatchCards,
  BuyerMatchUsedConditions,
} from './types.ts'

function used(over: Partial<BuyerMatchUsedConditions> = {}): BuyerMatchUsedConditions {
  return {
    muni_code_5: '46201',
    school_district_id: null,
    property_type: 'used_condo',
    price_min: 2000,
    price_max: 3000,
    ...over,
  }
}

function cards(over: Partial<BuyerMatchCards> = {}): BuyerMatchCards {
  return {
    opt_in: true,
    k: 5,
    max_cards: 6,
    stage: 1,
    used_conditions: used(),
    matched_count: 12,
    suppressed: false,
    cards: [],
    ...over,
  }
}

function card(over: Partial<BuyerMatchCard> = {}): BuyerMatchCard {
  return {
    property_types: ['used_condo'],
    price_min: 2000,
    price_max: 3000,
    desired_floor_area_min: 60,
    desired_floor_area_max: 80,
    desired_land_area_min: null,
    desired_land_area_max: null,
    desired_districts: [],
    ...over,
  }
}

// --- ボタン出し分け（裁定71） -------------------------------------------

test('opt_in=true ならボタンを出す', () => {
  assert.equal(shouldShowBuyerCardsButton(cards({ opt_in: true })), true)
})

test('opt_in=false ならボタンを出さない（案内文も出さない・裁定71）', () => {
  assert.equal(shouldShowBuyerCardsButton(cards({ opt_in: false })), false)
})

// --- カード領域の抑止（裁定72・⛔ length で判定しない） ------------------

test('suppressed=true はカード領域を出さない（cards が空でなくても）', () => {
  assert.equal(shouldShowBuyerCards(cards({ suppressed: true, cards: [card()] })), false)
})

test('stage=null はカード領域を出さない', () => {
  assert.equal(shouldShowBuyerCards(cards({ stage: null })), false)
})

test('⛔ cards.length では判定しない: 空でも suppressed=false かつ stage!=null なら出す', () => {
  // 抑止ではないが cards が 0 枚のケース。length で判定すると誤って隠れる。
  assert.equal(shouldShowBuyerCards(cards({ suppressed: false, stage: 2, cards: [] })), true)
})

test('通常（suppressed=false・stage あり）はカード領域を出す', () => {
  assert.equal(shouldShowBuyerCards(cards({ suppressed: false, stage: 4 })), true)
})

// --- 見出し（裁定73・used_conditions 由来） -----------------------------

test('段1/2（下限・上限とも）: {min}〜{max}万円で{種別}をお探しの方', () => {
  const h = buildBuyerCardsHeading(used({ price_min: 2000, price_max: 3000 }), '中古マンション', '岩国市')
  assert.equal(h, '2,000〜3,000万円で中古マンションをお探しの方')
})

test('上限のみ: {max}万円までで{種別}をお探しの方', () => {
  const h = buildBuyerCardsHeading(used({ price_min: null, price_max: 3000 }), '中古マンション', '岩国市')
  assert.equal(h, '3,000万円までで中古マンションをお探しの方')
})

test('下限のみ: {min}万円以上で{種別}をお探しの方', () => {
  const h = buildBuyerCardsHeading(used({ price_min: 2000, price_max: null }), '中古マンション', '岩国市')
  assert.equal(h, '2,000万円以上で中古マンションをお探しの方')
})

test('段3（価格なし・種別あり）: {種別}をお探しの方', () => {
  const h = buildBuyerCardsHeading(
    used({ price_min: null, price_max: null, property_type: 'land' }),
    '土地',
    '岩国市',
  )
  assert.equal(h, '土地をお探しの方')
})

test('段4（種別なし）: {市区町村名}で住まいをお探しの方', () => {
  const h = buildBuyerCardsHeading(
    used({ property_type: null, price_min: null, price_max: null }),
    null,
    '岩国市',
  )
  assert.equal(h, '岩国市で住まいをお探しの方')
})

test('種別 label が解決できないときは「指定なし」（⛔ code を出さない・裁定35）', () => {
  const h = buildBuyerCardsHeading(used({ price_min: null, price_max: null }), null, '岩国市')
  assert.equal(h, `${BUYER_MATCH_CARDS_MESSAGES.valueNone}をお探しの方`)
})

test('段4 で市区町村名が解決できないときは「指定なし」', () => {
  const h = buildBuyerCardsHeading(used({ property_type: null, price_min: null, price_max: null }), null, null)
  assert.equal(h, `${BUYER_MATCH_CARDS_MESSAGES.valueNone}で住まいをお探しの方`)
})

test('見出しに内部用語（段・stage）が出ない（裁定73）', () => {
  const h = buildBuyerCardsHeading(used(), '中古マンション', '岩国市')
  assert.equal(h.includes('段'), false)
  assert.equal(h.includes('stage'), false)
})

// --- バッジ（裁定76） --------------------------------------------------

test('バッジ: 先頭 code を label_ja に解決', () => {
  assert.equal(resolveCardBadgeLabel(['used_condo', 'land'], { used_condo: '中古マンション' }), '中古マンション')
})

test('バッジ: 未解決 code は「指定なし」（⛔ code を出さない）', () => {
  const label = resolveCardBadgeLabel(['unknown_code'], { used_condo: '中古マンション' })
  assert.equal(label, BUYER_MATCH_CARDS_MESSAGES.valueNone)
  assert.equal(label.includes('unknown_code'), false)
})

test('バッジ: property_types が空なら「指定なし」', () => {
  assert.equal(resolveCardBadgeLabel([], { used_condo: '中古マンション' }), BUYER_MATCH_CARDS_MESSAGES.valueNone)
})

// --- 希望予算行（裁定81） ----------------------------------------------

test('hasPriceRow: 両方 null は行を出さない', () => {
  assert.equal(hasPriceRow(null, null), false)
})

test('hasPriceRow: 片側でも値があれば行を出す', () => {
  assert.equal(hasPriceRow(2000, null), true)
  assert.equal(hasPriceRow(null, 3000), true)
})

test('formatCardPrice: {min}〜{max}万円（3桁区切り）', () => {
  assert.equal(formatCardPrice(2000, 3000), '2,000〜3,000万円')
})

test('formatCardPrice: 片側のみ', () => {
  assert.equal(formatCardPrice(null, 3000), '〜3,000万円')
  assert.equal(formatCardPrice(2000, null), '2,000万円〜')
})

test('formatCardPrice: 両方 null は「指定なし」', () => {
  assert.equal(formatCardPrice(null, null), BUYER_MATCH_CARDS_MESSAGES.valueNone)
})

// 裁定81: formatCardPrice は formatCardArea のコピーではない（単位が違う）が、整形の
//   分岐（両方あり／上限のみ／下限のみ／両方 null）は同型でなければならない。単位語だけを
//   差し替えれば一致することで「同じ分岐・違う単位」を担保する（⛔ 片方だけ分岐が崩れない）。
test('formatCardPrice と formatCardArea は整形分岐が同型（単位語のみ差）', () => {
  const cases: [number | null, number | null][] = [
    [2000, 3000], // 両方あり
    [null, 3000], // 上限のみ
    [2000, null], // 下限のみ
    [null, null], // 両方なし
  ]
  for (const [min, max] of cases) {
    const price = formatCardPrice(min, max)
    const area = formatCardArea(min, max)
    if (min === null && max === null) {
      // 両方 null はどちらも valueNone（単位語を持たない）。
      assert.equal(price, BUYER_MATCH_CARDS_MESSAGES.valueNone)
      assert.equal(area, BUYER_MATCH_CARDS_MESSAGES.valueNone)
      continue
    }
    // price の「万円」を「㎡」に置換すると area と一致する＝分岐が同型。
    assert.equal(price.replaceAll('万円', '㎡'), area)
  }
})

// --- 面積行（裁定76） --------------------------------------------------

test('hasAreaRow: 両方 null は行を出さない', () => {
  assert.equal(hasAreaRow(null, null), false)
})

test('hasAreaRow: 片側でも値があれば行を出す', () => {
  assert.equal(hasAreaRow(60, null), true)
  assert.equal(hasAreaRow(null, 80), true)
})

test('formatCardArea: {min}〜{max}㎡（3桁区切り）', () => {
  assert.equal(formatCardArea(1000, 2000), '1,000〜2,000㎡')
})

test('formatCardArea: 片側のみ', () => {
  assert.equal(formatCardArea(null, 80), '〜80㎡')
  assert.equal(formatCardArea(60, null), '60㎡〜')
})

test('formatCardArea: 両方 null は「指定なし」', () => {
  assert.equal(formatCardArea(null, null), BUYER_MATCH_CARDS_MESSAGES.valueNone)
})

// --- 校区行（裁定76） --------------------------------------------------

test('hasDistrictsRow: 空配列は行を出さない', () => {
  assert.equal(hasDistrictsRow(card({ desired_districts: [] })), false)
})

test('hasDistrictsRow: 要素があれば行を出す', () => {
  assert.equal(hasDistrictsRow(card({ desired_districts: ['A小学校区'] })), true)
})

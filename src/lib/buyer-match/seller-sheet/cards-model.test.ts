// =====================================================================
// PR-BM-9b-3 c1: PDF 2枚目「匿名カード」の表示モデル（model.ts の
//   buildBuyerCardsPageModel）の単体テスト。
//   ★3分岐（legacy / suppressed / cards）が display.ts の判定に一致することと、
//     整形が display.ts / messages.ts と同一結果になることを構造的に固定する。
//   ⛔ 禁止属性（氏名・担当・住所・反響日・媒体・間取り 等）を持つ口が無いことは、
//     BuyerMatchCard 型のキー集合（8つ）で担保される（display-cards.test.ts と同方針）。
// =====================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildBuyerCardsPageModel } from './model.ts'
import { BUYER_MATCH_CARDS_MESSAGES } from '../messages.ts'
import type {
  BuyerMatchCard,
  BuyerMatchCards,
  BuyerMatchUsedConditions,
} from '../types.ts'

const LABELS: Record<string, string> = {
  used_condo: '中古マンション',
  new_house: '新築戸建',
}
const MUNI: Record<string, string> = { '35208': '岩国市' }

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

function used(over: Partial<BuyerMatchUsedConditions> = {}): BuyerMatchUsedConditions {
  return {
    muni_code_5: '35208',
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
    cards: [card()],
    ...over,
  }
}

test('opt_in=false は legacy 分岐（従来のセル集計2枚目のまま）', () => {
  const m = buildBuyerCardsPageModel(cards({ opt_in: false }), LABELS, MUNI)
  assert.equal(m.kind, 'legacy')
})

test('opt_in=true でも suppressed=true は suppressed 分岐（⛔ cards.length で判定しない）', () => {
  // cards が空でなくても suppressed なら抑止（length では区別しない）。
  const m = buildBuyerCardsPageModel(
    cards({ suppressed: true, cards: [card(), card()] }),
    LABELS,
    MUNI,
  )
  assert.equal(m.kind, 'suppressed')
})

test('opt_in=true でも stage=null は suppressed 分岐', () => {
  const m = buildBuyerCardsPageModel(cards({ stage: null }), LABELS, MUNI)
  assert.equal(m.kind, 'suppressed')
})

test('cards 分岐: 見出しは used_conditions 由来・人数は matched_count', () => {
  const m = buildBuyerCardsPageModel(cards({ matched_count: 12 }), LABELS, MUNI)
  assert.equal(m.kind, 'cards')
  if (m.kind !== 'cards') return
  assert.equal(m.heading, '2,000〜3,000万円で中古マンションをお探しの方')
  assert.equal(m.countLabel, '12名')
})

test('cards 分岐: 段4（種別 null）の見出しは市区町村名で組む', () => {
  const m = buildBuyerCardsPageModel(
    cards({ used_conditions: used({ property_type: null, price_min: null, price_max: null }) }),
    LABELS,
    MUNI,
  )
  assert.equal(m.kind, 'cards')
  if (m.kind !== 'cards') return
  assert.equal(m.heading, '岩国市で住まいをお探しの方')
})

test('cards 分岐: #01 連番は index+1・2桁ゼロ詰め', () => {
  const m = buildBuyerCardsPageModel(cards({ cards: [card(), card(), card()] }), LABELS, MUNI)
  assert.equal(m.kind, 'cards')
  if (m.kind !== 'cards') return
  assert.deepEqual(
    m.cards.map((c) => c.number),
    ['#01', '#02', '#03'],
  )
})

test('cards 分岐: バッジは property_types 先頭を label_ja で解決（解決不能は「指定なし」）', () => {
  const m = buildBuyerCardsPageModel(
    cards({ cards: [card({ property_types: ['new_house'] }), card({ property_types: ['zzz_unknown'] })] }),
    LABELS,
    MUNI,
  )
  assert.equal(m.kind, 'cards')
  if (m.kind !== 'cards') return
  assert.equal(m.cards[0].badge, '新築戸建')
  assert.equal(m.cards[1].badge, BUYER_MATCH_CARDS_MESSAGES.valueNone)
})

test('cards 分岐: 行の有無と整形（希望予算・専有面積・土地面積・校区）', () => {
  const m = buildBuyerCardsPageModel(
    cards({
      cards: [
        card({
          price_min: 2000,
          price_max: null,
          desired_floor_area_min: 60,
          desired_floor_area_max: 80,
          desired_land_area_min: null,
          desired_land_area_max: null,
          desired_districts: ['川下', '愛宕'],
        }),
      ],
    }),
    LABELS,
    MUNI,
  )
  assert.equal(m.kind, 'cards')
  if (m.kind !== 'cards') return
  const c = m.cards[0]
  // 希望予算（片側のみ）＝「2,000万円〜」・ラベルは messages 参照。
  assert.deepEqual(c.priceRow, { label: BUYER_MATCH_CARDS_MESSAGES.rowPrice, value: '2,000万円〜' })
  // 専有面積あり。
  assert.deepEqual(c.floorRow, { label: BUYER_MATCH_CARDS_MESSAGES.rowFloorArea, value: '60〜80㎡' })
  // 土地面積は両方 null → 行ごと出さない。
  assert.equal(c.landRow, null)
  // 校区は「、」で結合（裁定96 の複製）。
  assert.deepEqual(c.districtsRow, {
    label: BUYER_MATCH_CARDS_MESSAGES.rowDistricts,
    value: '川下、愛宕',
  })
})

test('cards 分岐: 校区が空配列なら校区行を出さない', () => {
  const m = buildBuyerCardsPageModel(cards({ cards: [card({ desired_districts: [] })] }), LABELS, MUNI)
  assert.equal(m.kind, 'cards')
  if (m.kind !== 'cards') return
  assert.equal(m.cards[0].districtsRow, null)
})

test('cards 分岐: カードの行は label/value 以外のキーを持たない（禁止属性の混入防止）', () => {
  const m = buildBuyerCardsPageModel(cards(), LABELS, MUNI)
  assert.equal(m.kind, 'cards')
  if (m.kind !== 'cards') return
  const c = m.cards[0]
  for (const row of [c.priceRow, c.floorRow, c.landRow, c.districtsRow]) {
    if (row === null) continue
    assert.deepEqual(Object.keys(row).sort(), ['label', 'value'])
  }
  // カード自体のキーも表示用の6つだけ。
  assert.deepEqual(Object.keys(c).sort(), [
    'badge',
    'districtsRow',
    'floorRow',
    'landRow',
    'number',
    'priceRow',
  ])
})

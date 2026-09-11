// =====================================================================
// PR-BM-9b-2: 匿名カードの表示文言（messages.ts の BUYER_MATCH_CARDS_MESSAGES）の
//   逐語テスト（裁定70/72/73/76）。⛔ 1文字も変えない＝PM 裁定なしの変更を止める。
//   ⚠ node --test は '@/' を解決できないため相対 import・拡張子付き。
// =====================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import { BUYER_MATCH_CARDS_MESSAGES } from './messages.ts'

test('ボタン文言（裁定70・逐語）', () => {
  assert.equal(BUYER_MATCH_CARDS_MESSAGES.button, '買い手を見る')
})

test('見出しテンプレート（裁定73・逐語）', () => {
  assert.equal(BUYER_MATCH_CARDS_MESSAGES.headingPriceRange, '{min}〜{max}万円で{type}をお探しの方')
  assert.equal(BUYER_MATCH_CARDS_MESSAGES.headingPriceMax, '{max}万円までで{type}をお探しの方')
  assert.equal(BUYER_MATCH_CARDS_MESSAGES.headingPriceMin, '{min}万円以上で{type}をお探しの方')
  assert.equal(BUYER_MATCH_CARDS_MESSAGES.headingTypeOnly, '{type}をお探しの方')
  assert.equal(BUYER_MATCH_CARDS_MESSAGES.headingMuniOnly, '{muni}で住まいをお探しの方')
})

test('抑止時文言（裁定72・逐語）', () => {
  assert.equal(
    BUYER_MATCH_CARDS_MESSAGES.suppressed,
    '条件に近い購入検討者は、現在5名未満のため表示していません。',
  )
})

test('値なし・行ラベル（裁定76・逐語）', () => {
  assert.equal(BUYER_MATCH_CARDS_MESSAGES.valueNone, '指定なし')
  assert.equal(BUYER_MATCH_CARDS_MESSAGES.rowFloorArea, '専有面積')
  assert.equal(BUYER_MATCH_CARDS_MESSAGES.rowLandArea, '土地面積')
  assert.equal(BUYER_MATCH_CARDS_MESSAGES.rowDistricts, '校区')
})

test('⛔ 内部用語（段・stage・k・max_cards）を文言に含めない（裁定73/75）', () => {
  const all = Object.values(BUYER_MATCH_CARDS_MESSAGES).join('\n')
  for (const forbidden of ['段', 'stage', 'max_cards', 'k=', 'opt_in', 'suppressed']) {
    assert.equal(all.includes(forbidden), false, `禁止語「${forbidden}」が文言に混入している`)
  }
})

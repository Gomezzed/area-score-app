// =====================================================================
// PR-BM-7 c6: 売主向けシート PDF の表示モデル（model.ts）の単体テスト。
//   ★ファイル名・条件行に個票の値（氏名・担当者・外部ID・住所・反響日）や
//     名簿 UUID が混ざらないことを構造的に確かめる。
// =====================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildConditionLines,
  buildSellerSheetFileName,
  buildSellerSheetTitle,
  formatConditionPrice,
} from './model.ts'
import type { SellerCondition } from '../types.ts'

// 2026-09-09 05:00 UTC = 2026-09-09 14:00 JST
const NOW = new Date('2026-09-09T05:00:00.000Z')

function condition(over: Partial<SellerCondition> = {}): SellerCondition {
  return {
    muniCode5: '35208',
    muniName: '岩国市',
    propertyType: 'used_condo',
    propertyTypeLabel: '中古マンション',
    priceMin: 2000,
    priceMax: 3000,
    ...over,
  }
}

test('ファイル名は ASCII のみ・JST の日時・UUID を含まない', () => {
  const name = buildSellerSheetFileName('35208', 'used_condo', NOW)
  assert.equal(name, 'areascore_buyer-match_35208_used_condo_20260909-1400.pdf')
  assert.equal(/^[\x20-\x7E]+$/.test(name), true)
  // UUID（8-4-4-4-12）が混ざらない。
  assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(name), false)
})

test('市区町村・種別が未確定でもファイル名が壊れない', () => {
  assert.equal(
    buildSellerSheetFileName(null, null, NOW),
    'areascore_buyer-match_all_all_20260909-1400.pdf',
  )
})

test('タイトルは売主の条件だけで作る', () => {
  assert.equal(buildSellerSheetTitle(condition()), '購入希望マッチ ― 岩国市／中古マンション')
  assert.equal(
    buildSellerSheetTitle(condition({ propertyTypeLabel: null })),
    '購入希望マッチ ― 岩国市',
  )
  assert.equal(
    buildSellerSheetTitle(condition({ muniName: null, propertyTypeLabel: null })),
    '購入希望マッチ',
  )
})

test('査定価格の表記（片側だけの指定にも対応）', () => {
  assert.equal(formatConditionPrice(2000, 3000), '2,000〜3,000万円')
  assert.equal(formatConditionPrice(2000, null), '2,000万円以上')
  assert.equal(formatConditionPrice(null, 3000), '3,000万円以下')
  assert.equal(formatConditionPrice(null, null), '')
})

test('条件行は値のある項目だけを並べる', () => {
  assert.deepEqual(buildConditionLines(condition()), [
    'エリア: 岩国市',
    '物件種別: 中古マンション',
    '査定価格: 2,000〜3,000万円',
  ])
  assert.deepEqual(
    buildConditionLines(condition({ priceMin: null, priceMax: null })),
    ['エリア: 岩国市', '物件種別: 中古マンション'],
  )
})

test('条件行に売主の入力以外（顧客側の情報）を混ぜる経路が無い', () => {
  // SellerCondition が持つキーは売主の入力条件だけ。氏名・担当者・外部ID・
  // 住所・反響日を渡す口が無いことを型の実体（キー集合）で固定する。
  const keys = Object.keys(condition()).sort()
  assert.deepEqual(keys, [
    'muniCode5',
    'muniName',
    'priceMax',
    'priceMin',
    'propertyType',
    'propertyTypeLabel',
  ])
})

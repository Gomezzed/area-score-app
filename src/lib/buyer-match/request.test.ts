// =====================================================================
// PR-BM-7 c6: クエリ組立（request.ts）の単体テスト。
//   ★最重要: school_district_id を絶対に送らない（裁定33・案A）。
// =====================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildBuyerMatchQueryString, isValidPrice, parsePriceInput } from './request.ts'

test('⛔ school_district_id を絶対に含まない（裁定33・案A）', () => {
  const q = buildBuyerMatchQueryString({
    muniCode5: '35208',
    propertyType: 'used_condo',
    priceMin: 2000,
    priceMax: 3000,
  })
  assert.equal(q.includes('school_district_id'), false)
  assert.equal(q.includes('school'), false)
})

test('指定した条件だけをキーに出す', () => {
  const q = buildBuyerMatchQueryString({
    muniCode5: '35208',
    propertyType: 'used_condo',
    priceMin: 2000,
    priceMax: 3000,
  })
  assert.equal(q, 'muni_code_5=35208&property_type=used_condo&price_min=2000&price_max=3000')
})

test('未指定（null）はキーごと出さない（空文字を送らない）', () => {
  const q = buildBuyerMatchQueryString({
    muniCode5: '35208',
    propertyType: null,
    priceMin: null,
    priceMax: null,
  })
  assert.equal(q, 'muni_code_5=35208')
})

test('すべて未指定なら空文字（? を付けない呼び出し側の分岐に対応）', () => {
  const q = buildBuyerMatchQueryString({
    muniCode5: null,
    propertyType: null,
    priceMin: null,
    priceMax: null,
  })
  assert.equal(q, '')
})

test('価格は整数かつ 0 以上のみ送る（400 を踏まない）', () => {
  assert.equal(isValidPrice(0), true)
  assert.equal(isValidPrice(2000), true)
  assert.equal(isValidPrice(-1), false)
  assert.equal(isValidPrice(1.5), false)
  assert.equal(isValidPrice(null), false)
  const q = buildBuyerMatchQueryString({
    muniCode5: null,
    propertyType: null,
    priceMin: -1,
    priceMax: 1.5,
  })
  assert.equal(q, '')
})

test('入力欄のパース: 空・非整数・負値・全角は null', () => {
  assert.equal(parsePriceInput('2000'), 2000)
  assert.equal(parsePriceInput(' 2000 '), 2000)
  assert.equal(parsePriceInput('0'), 0)
  assert.equal(parsePriceInput(''), null)
  assert.equal(parsePriceInput('  '), null)
  assert.equal(parsePriceInput('2,000'), null)
  assert.equal(parsePriceInput('1.5'), null)
  assert.equal(parsePriceInput('-1'), null)
  assert.equal(parsePriceInput('２０００'), null)
  assert.equal(parsePriceInput('abc'), null)
})

// =====================================================================
// PR-BM-7 c6: クエリ組立（request.ts）の単体テスト。
//   ★最重要: school_district_id を絶対に送らない（裁定33・案A）。
// =====================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BUYER_MATCH_ROUTE,
  buildBuyerMatchQueryString,
  buildEditHref,
  buildPresentHref,
  isPresentMode,
  isValidPrice,
  parsePriceInput,
} from './request.ts'

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

// ---------------------------------------------------------------------
// A3-1（仮番 -bm-M）: 提示モード（?present=1）の URL 補助。
// ---------------------------------------------------------------------
const CONDITIONS = {
  muniCode5: '35208',
  propertyType: 'used_condo',
  priceMin: 2000,
  priceMax: 3000,
}

test('isPresentMode: present=1 のときのみ true', () => {
  assert.equal(isPresentMode(new URLSearchParams('present=1')), true)
  assert.equal(isPresentMode(new URLSearchParams('muni_code_5=35208&present=1')), true)
  assert.equal(isPresentMode(new URLSearchParams('present=0')), false)
  assert.equal(isPresentMode(new URLSearchParams('present=true')), false)
  assert.equal(isPresentMode(new URLSearchParams('present=')), false)
  assert.equal(isPresentMode(new URLSearchParams('')), false)
})

test('buildPresentHref: 4条件＋present=1（ちょうど1回・list なし）', () => {
  const href = buildPresentHref(CONDITIONS)
  assert.equal(
    href,
    '/customers/buyer-match?muni_code_5=35208&property_type=used_condo&price_min=2000&price_max=3000&present=1',
  )
  assert.equal(href.startsWith(`${BUYER_MATCH_ROUTE}?`), true)
  assert.equal(href.split('present=').length - 1, 1)
  assert.equal(href.includes('list='), false)
})

test('buildPresentHref: 価格なしでも条件を保つ', () => {
  assert.equal(
    buildPresentHref({ ...CONDITIONS, priceMin: null, priceMax: null }),
    '/customers/buyer-match?muni_code_5=35208&property_type=used_condo&present=1',
  )
})

test('buildEditHref: 4条件を保ち present を含まない（list なし）', () => {
  const href = buildEditHref(CONDITIONS)
  assert.equal(
    href,
    '/customers/buyer-match?muni_code_5=35208&property_type=used_condo&price_min=2000&price_max=3000',
  )
  assert.equal(href.includes('present'), false)
  assert.equal(href.includes('list='), false)
})

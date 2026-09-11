import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BUYER_MATCH_PROPERTY_TYPE_CODES,
  parseBuyerMatchCardsQueryParams,
} from './query-params.ts'

// PR-BM-9b-1: cards ルート専用パースの純ロジック単体テスト（DB を叩かない）。
//   BM-5 の query-params.test.ts は不変更。cards 固有の差分だけをここで検証する:
//     - property_type は必須（裁定57）
//     - school_district_id は受け取らない・無視（裁定67）
//     - muni_code_5 は任意・生値透過（裁定65）
//     - price_min / price_max は任意・非負整数（既存流用）

// --- property_type（必須・裁定57） -----------------------------------

test('property_type 未指定は ok:false・parameter=property_type（cards は必須）', () => {
  const result = parseBuyerMatchCardsQueryParams(new URLSearchParams())
  assert.deepEqual(result, { ok: false, parameter: 'property_type' })
})

test('property_type が allowlist 外なら ok:false・parameter=property_type', () => {
  const result = parseBuyerMatchCardsQueryParams(
    new URLSearchParams({ property_type: 'mansion' }),
  )
  assert.deepEqual(result, { ok: false, parameter: 'property_type' })
})

test('property_type 空文字は ok:false・parameter=property_type', () => {
  const result = parseBuyerMatchCardsQueryParams(
    new URLSearchParams({ property_type: '' }),
  )
  assert.deepEqual(result, { ok: false, parameter: 'property_type' })
})

test('property_type: allowlist の6値はそのまま通る', () => {
  for (const code of BUYER_MATCH_PROPERTY_TYPE_CODES) {
    const result = parseBuyerMatchCardsQueryParams(
      new URLSearchParams({ property_type: code }),
    )
    assert.equal(result.ok, true)
    assert.equal(result.ok && result.params.propertyType, code)
  }
})

// --- school_district_id（受け取らない・裁定67） ----------------------

test('school_district_id は無視され 400 にならない（不正 uuid でも ok:true）', () => {
  const result = parseBuyerMatchCardsQueryParams(
    new URLSearchParams({ property_type: 'used_condo', school_district_id: 'not-a-uuid' }),
  )
  assert.equal(result.ok, true)
})

test('school_district_id は params に含まれない（cards は保持しない）', () => {
  const result = parseBuyerMatchCardsQueryParams(
    new URLSearchParams({
      property_type: 'used_condo',
      school_district_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    }),
  )
  assert.equal(result.ok, true)
  assert.equal(result.ok && 'schoolDistrictId' in result.params, false)
})

// --- muni_code_5（任意・生値透過・裁定65） ---------------------------

test('muni_code_5 は形式検証せず生値をそのまま通す（任意）', () => {
  const result = parseBuyerMatchCardsQueryParams(
    new URLSearchParams({ property_type: 'land', muni_code_5: '352080' }),
  )
  assert.equal(result.ok, true)
  assert.equal(result.ok && result.params.muniCode5, '352080')
})

test('muni_code_5 未指定は null', () => {
  const result = parseBuyerMatchCardsQueryParams(
    new URLSearchParams({ property_type: 'land' }),
  )
  assert.equal(result.ok, true)
  assert.equal(result.ok && result.params.muniCode5, null)
})

// --- price_min / price_max（任意・非負整数） -------------------------

test('price_min/price_max 未指定は null', () => {
  const result = parseBuyerMatchCardsQueryParams(
    new URLSearchParams({ property_type: 'used_condo' }),
  )
  assert.equal(result.ok, true)
  assert.equal(result.ok && result.params.priceMin, null)
  assert.equal(result.ok && result.params.priceMax, null)
})

test('price_min が非整数なら ok:false・parameter=price_min', () => {
  const result = parseBuyerMatchCardsQueryParams(
    new URLSearchParams({ property_type: 'used_condo', price_min: '1.5' }),
  )
  assert.deepEqual(result, { ok: false, parameter: 'price_min' })
})

test('price_max が負値なら ok:false・parameter=price_max', () => {
  const result = parseBuyerMatchCardsQueryParams(
    new URLSearchParams({ property_type: 'used_condo', price_max: '-1' }),
  )
  assert.deepEqual(result, { ok: false, parameter: 'price_max' })
})

// --- 全指定・正常系 --------------------------------------------------

test('全パラメータ指定・正常系（school_district_id は無視される）', () => {
  const result = parseBuyerMatchCardsQueryParams(
    new URLSearchParams({
      muni_code_5: '352080',
      school_district_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      property_type: 'used_condo',
      price_min: '2000',
      price_max: '5000',
    }),
  )
  assert.deepEqual(result, {
    ok: true,
    params: {
      muniCode5: '352080',
      propertyType: 'used_condo',
      priceMin: 2000,
      priceMax: 5000,
    },
  })
})

// --- 検証順序（property_type > price_min > price_max） ---------------

test('複数不正でも最初に検査した property_type のみ返す', () => {
  const result = parseBuyerMatchCardsQueryParams(
    new URLSearchParams({ property_type: 'mansion', price_min: '-1', price_max: '-1' }),
  )
  assert.deepEqual(result, { ok: false, parameter: 'property_type' })
})

// --- 不正値のエコー防止（D144） --------------------------------------

test('不正値そのものは結果オブジェクトにエコーされない（D144）', () => {
  const result = parseBuyerMatchCardsQueryParams(
    new URLSearchParams({ property_type: 'SECRET_LOOKING_VALUE' }),
  )
  assert.equal(JSON.stringify(result).includes('SECRET_LOOKING_VALUE'), false)
})

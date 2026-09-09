import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BUYER_MATCH_PROPERTY_TYPE_CODES,
  parsePropertyType,
  parseSchoolDistrictId,
  parsePriceMin,
  parsePriceMax,
  parseBuyerMatchQueryParams,
} from './query-params.ts'

// PR-BM-5: buyer-match クエリ引数パースの純ロジック単体テスト（DB を叩かない・
// 既存 areas/school-type.test.ts と同型）。

test('allowlist は property_types.code の6値（PRICE_TARGETS 由来）', () => {
  assert.deepEqual(
    [...BUYER_MATCH_PROPERTY_TYPE_CODES].sort(),
    ['commercial', 'land', 'new_condo', 'new_detached', 'used_condo', 'used_detached'].sort(),
  )
})

// --- parsePropertyType -----------------------------------------------

test('property_type: 未指定(null)は null（RPCへNULLを渡す）', () => {
  assert.equal(parsePropertyType(null), null)
})

test('property_type: allowlist の6値はそのまま通る', () => {
  for (const code of BUYER_MATCH_PROPERTY_TYPE_CODES) {
    assert.equal(parsePropertyType(code), code)
  }
})

test('property_type: allowlist 外は undefined（呼び出し側で400）', () => {
  assert.equal(parsePropertyType('mansion'), undefined)
  assert.equal(parsePropertyType(''), undefined)
  assert.equal(parsePropertyType('NEW_DETACHED'), undefined)
})

// --- parseSchoolDistrictId --------------------------------------------

test('school_district_id: 未指定(null)は null', () => {
  assert.equal(parseSchoolDistrictId(null), null)
})

test('school_district_id: uuid形式はそのまま通る（大文字小文字を正規化しない）', () => {
  const lower = '3fa85f64-5717-4562-b3fc-2c963f66afa6'
  const upper = '3FA85F64-5717-4562-B3FC-2C963F66AFA6'
  assert.equal(parseSchoolDistrictId(lower), lower)
  assert.equal(parseSchoolDistrictId(upper), upper)
})

test('school_district_id: uuid形式でなければ undefined', () => {
  assert.equal(parseSchoolDistrictId('not-a-uuid'), undefined)
  assert.equal(parseSchoolDistrictId(''), undefined)
  assert.equal(parseSchoolDistrictId('3fa85f64-5717-4562-b3fc-2c963f66afa'), undefined) // 1桁短い
})

// --- parsePriceMin / parsePriceMax -------------------------------------

test('price_min/price_max: 未指定(null)は null', () => {
  assert.equal(parsePriceMin(null), null)
  assert.equal(parsePriceMax(null), null)
})

test('price_min/price_max: 非負整数はそのまま数値で通る', () => {
  assert.equal(parsePriceMin('0'), 0)
  assert.equal(parsePriceMin('3000'), 3000)
  assert.equal(parsePriceMax('100000000'), 100000000)
})

test('price_min/price_max: 負値は undefined', () => {
  assert.equal(parsePriceMin('-1'), undefined)
  assert.equal(parsePriceMax('-3000'), undefined)
})

test('price_min/price_max: 非整数は undefined', () => {
  assert.equal(parsePriceMin('1.5'), undefined)
  assert.equal(parsePriceMin('1e3'), undefined)
  assert.equal(parsePriceMin('abc'), undefined)
  assert.equal(parsePriceMin(''), undefined)
  assert.equal(parsePriceMin(' 1'), undefined)
})

// --- parseBuyerMatchQueryParams（統合） --------------------------------

test('全パラメータ未指定は ok:true・全項目 null', () => {
  const result = parseBuyerMatchQueryParams(new URLSearchParams())
  assert.deepEqual(result, {
    ok: true,
    params: {
      muniCode5: null,
      schoolDistrictId: null,
      propertyType: null,
      priceMin: null,
      priceMax: null,
    },
  })
})

test('muni_code_5 は形式検証せず生値をそのまま通す（O49・正規化しない）', () => {
  const result = parseBuyerMatchQueryParams(new URLSearchParams({ muni_code_5: '352080' }))
  assert.equal(result.ok, true)
  assert.equal(result.ok && result.params.muniCode5, '352080')
})

test('全パラメータ指定・正常系', () => {
  const result = parseBuyerMatchQueryParams(
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
      schoolDistrictId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      propertyType: 'used_condo',
      priceMin: 2000,
      priceMax: 5000,
    },
  })
})

test('property_type が allowlist 外なら ok:false・parameter=property_type', () => {
  const result = parseBuyerMatchQueryParams(new URLSearchParams({ property_type: 'mansion' }))
  assert.deepEqual(result, { ok: false, parameter: 'property_type' })
})

test('school_district_id が uuid でなければ ok:false・parameter=school_district_id', () => {
  const result = parseBuyerMatchQueryParams(
    new URLSearchParams({ school_district_id: 'not-a-uuid' }),
  )
  assert.deepEqual(result, { ok: false, parameter: 'school_district_id' })
})

test('price_min が非整数なら ok:false・parameter=price_min', () => {
  const result = parseBuyerMatchQueryParams(new URLSearchParams({ price_min: '-1' }))
  assert.deepEqual(result, { ok: false, parameter: 'price_min' })
})

test('price_max が非整数なら ok:false・parameter=price_max', () => {
  const result = parseBuyerMatchQueryParams(new URLSearchParams({ price_max: '1.5' }))
  assert.deepEqual(result, { ok: false, parameter: 'price_max' })
})

test('複数不正でも最初に検査した項目のみ返す（property_type > school_district_id > price_min > price_max の順）', () => {
  const result = parseBuyerMatchQueryParams(
    new URLSearchParams({
      property_type: 'mansion',
      school_district_id: 'not-a-uuid',
      price_min: '-1',
      price_max: '-1',
    }),
  )
  assert.deepEqual(result, { ok: false, parameter: 'property_type' })
})

test('不正値そのものは結果オブジェクトにエコーされない（D144）', () => {
  const result = parseBuyerMatchQueryParams(
    new URLSearchParams({ property_type: 'SECRET_LOOKING_VALUE' }),
  )
  assert.equal(JSON.stringify(result).includes('SECRET_LOOKING_VALUE'), false)
})

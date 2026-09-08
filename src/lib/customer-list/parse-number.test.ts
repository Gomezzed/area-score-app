// 希望条件の数値パーサ（価格＝万円 / 面積＝㎡）のユニットテスト。依存ゼロ。
//   ⛔ 顧客の生データは使わない（架空値のみ）。
//   原則1: 解釈が要る値は値を作らず unparsed にすることを固定する。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePriceManyen, parseAreaSqm } from './parse-number.ts'

test('価格: 数字のみ・桁区切り・接尾辞（万円/万）を受け付ける', () => {
  assert.deepEqual(parsePriceManyen('3000'), { value: 3000, unparsed: false })
  assert.deepEqual(parsePriceManyen('3,000'), { value: 3000, unparsed: false })
  assert.deepEqual(parsePriceManyen('3000万円'), { value: 3000, unparsed: false })
  assert.deepEqual(parsePriceManyen('3,000万'), { value: 3000, unparsed: false })
  assert.deepEqual(parsePriceManyen('0'), { value: 0, unparsed: false })
  assert.deepEqual(parsePriceManyen(' 12,345,678 '), { value: 12345678, unparsed: false })
})

test('価格: 全角数字・全角カンマは NFKC で吸収する', () => {
  assert.deepEqual(parsePriceManyen('３０００'), { value: 3000, unparsed: false })
  assert.deepEqual(parsePriceManyen('３，０００万円'), { value: 3000, unparsed: false })
})

test('面積: ㎡ / m2 / m² のいずれも同じ値になる（NFKC で 1 経路に揃う）', () => {
  assert.deepEqual(parseAreaSqm('85'), { value: 85, unparsed: false })
  assert.deepEqual(parseAreaSqm('85㎡'), { value: 85, unparsed: false })
  assert.deepEqual(parseAreaSqm('85m2'), { value: 85, unparsed: false })
  assert.deepEqual(parseAreaSqm('85m²'), { value: 85, unparsed: false })
  assert.deepEqual(parseAreaSqm('1,200㎡'), { value: 1200, unparsed: false })
})

test('未入力（空文字・空白・null・undefined）は値も理由も作らない', () => {
  for (const v of ['', '   ', '　', null, undefined]) {
    assert.deepEqual(parsePriceManyen(v), { value: null, unparsed: false })
    assert.deepEqual(parseAreaSqm(v), { value: null, unparsed: false })
  }
})

test('⛔ 坪は換算せず unparsed（推定を確定値に混ぜない）', () => {
  assert.deepEqual(parseAreaSqm('30坪'), { value: null, unparsed: true })
  assert.deepEqual(parseAreaSqm('30 坪'), { value: null, unparsed: true })
})

test('⛔ 範囲表記・文字混じりは片側を拾わず unparsed', () => {
  assert.deepEqual(parsePriceManyen('3000〜4000'), { value: null, unparsed: true })
  assert.deepEqual(parsePriceManyen('3000-4000'), { value: null, unparsed: true })
  assert.deepEqual(parsePriceManyen('約3000'), { value: null, unparsed: true })
  assert.deepEqual(parsePriceManyen('3000万円以下'), { value: null, unparsed: true })
  assert.deepEqual(parsePriceManyen('応相談'), { value: null, unparsed: true })
  assert.deepEqual(parseAreaSqm('80㎡以上'), { value: null, unparsed: true })
})

test('⛔ 小数は丸めず unparsed（DB は integer）', () => {
  assert.deepEqual(parseAreaSqm('80.5'), { value: null, unparsed: true })
  assert.deepEqual(parseAreaSqm('80.5㎡'), { value: null, unparsed: true })
  assert.deepEqual(parsePriceManyen('3000.0'), { value: null, unparsed: true })
})

test('⛔ 負値・符号付き・不正な桁区切りは unparsed', () => {
  assert.deepEqual(parsePriceManyen('-10'), { value: null, unparsed: true })
  assert.deepEqual(parsePriceManyen('+10'), { value: null, unparsed: true })
  assert.deepEqual(parsePriceManyen('3,00'), { value: null, unparsed: true })
  assert.deepEqual(parsePriceManyen('1,2345'), { value: null, unparsed: true })
  assert.deepEqual(parsePriceManyen(','), { value: null, unparsed: true })
})

test('⛔ PostgreSQL の integer 上限を超える値は切り詰めず unparsed', () => {
  assert.deepEqual(parsePriceManyen('2147483647'), { value: 2147483647, unparsed: false })
  assert.deepEqual(parsePriceManyen('2147483648'), { value: null, unparsed: true })
  assert.deepEqual(parseAreaSqm('99999999999'), { value: null, unparsed: true })
})

test('接尾辞だけ・接尾辞の重複は unparsed', () => {
  assert.deepEqual(parsePriceManyen('万円'), { value: null, unparsed: true })
  assert.deepEqual(parseAreaSqm('㎡'), { value: null, unparsed: true })
  assert.deepEqual(parsePriceManyen('3000万円万'), { value: null, unparsed: true })
})

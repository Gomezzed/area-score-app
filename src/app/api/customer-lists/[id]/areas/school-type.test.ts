import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAreasSchoolType, AREAS_SCHOOL_TYPES } from './school-type.ts'

// 取込エリア一覧 API（SD-44）の school_type バリデーション純ロジックの単体テスト。

test('未指定(null)は既定 elementary に落ちる', () => {
  assert.equal(parseAreasSchoolType(null), 'elementary')
})

test('elementary はそのまま通る', () => {
  assert.equal(parseAreasSchoolType('elementary'), 'elementary')
})

test('junior_high はそのまま通る', () => {
  assert.equal(parseAreasSchoolType('junior_high'), 'junior_high')
})

test('allowlist 外は null（呼び出し側で 400）', () => {
  assert.equal(parseAreasSchoolType('compulsory'), null)
  assert.equal(parseAreasSchoolType('high'), null)
})

test('空文字は null（?school_type= の空指定を弾く）', () => {
  assert.equal(parseAreasSchoolType(''), null)
})

test('大文字/表記ゆれは受け付けない（完全一致のみ）', () => {
  assert.equal(parseAreasSchoolType('ELEMENTARY'), null)
  assert.equal(parseAreasSchoolType('Junior_High'), null)
  assert.equal(parseAreasSchoolType(' elementary '), null)
})

test('allowlist は elementary / junior_high の 2 値のみ', () => {
  assert.deepEqual([...AREAS_SCHOOL_TYPES], ['elementary', 'junior_high'])
})

// preset 復元（PR-F c3）の純関数ユニットテスト。依存ゼロ・DB 不要。
//   presetChoiceFromMapping が customer_lists.column_mapping(v:2) から
//   前回の CSV 形式選択を正しく復元することを固定する。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { presetChoiceFromMapping } from './preset-choice.ts'

test('未取込/欠損（null・undefined・非オブジェクト）は未選択 ""', () => {
  assert.equal(presetChoiceFromMapping(null), '')
  assert.equal(presetChoiceFromMapping(undefined), '')
  assert.equal(presetChoiceFromMapping('x'), '')
  assert.equal(presetChoiceFromMapping(42), '')
})

test('v:2 かつ preset_id="hausudo" は hausudo を復元', () => {
  const mapping = {
    v: 2,
    columns: { address: '住所' },
    resolve_route: 'preset',
    preset_id: 'hausudo',
  }
  assert.equal(presetChoiceFromMapping(mapping), 'hausudo')
})

test('v:2 かつ preset_id 無し（?preset= を付けず取込）は other（自動判定）', () => {
  const mapping = { v: 2, columns: { address: '住所' }, resolve_route: 'heuristic' }
  assert.equal(presetChoiceFromMapping(mapping), 'other')
})

test('v:2 かつ preset_id="" は other 扱い', () => {
  const mapping = { v: 2, columns: {}, resolve_route: 'heuristic', preset_id: '' }
  assert.equal(presetChoiceFromMapping(mapping), 'other')
})

test('v:2 だが未知の preset_id は未選択 ""（未知 preset を復元しない）', () => {
  const mapping = { v: 2, columns: {}, resolve_route: 'preset', preset_id: 'unknown_x' }
  assert.equal(presetChoiceFromMapping(mapping), '')
})

test('レガシー flat 形（v なし）は未選択 ""（プリセット概念が無い）', () => {
  const legacyFlat = { address: 0, customer_name: 1 }
  assert.equal(presetChoiceFromMapping(legacyFlat), '')
})

test('v が 2 以外（例: 1）は未選択 ""', () => {
  assert.equal(presetChoiceFromMapping({ v: 1, preset_id: 'hausudo' }), '')
})

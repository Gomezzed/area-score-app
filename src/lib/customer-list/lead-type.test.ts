// 反響区分（lead_type）辞書のユニットテスト。依存ゼロ。
//   ⛔ 顧客の生データは使わない（架空値のみ）。
//   O49: 部分一致・前方一致で拾わないこと（＝推測しないこと）を固定する。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toLeadType, countLeadTypes, type LeadType } from './lead-type.ts'

test('買主 → buy / 売主 → sell（完全一致）', () => {
  assert.equal(toLeadType('買主'), 'buy')
  // ★ '売主' は実 CSV 未確認の仮置き。表記が判明したら辞書と本テストを直す。
  assert.equal(toLeadType('売主'), 'sell')
})

test('空文字・空白のみ・null・undefined は unknown', () => {
  assert.equal(toLeadType(''), 'unknown')
  assert.equal(toLeadType('   '), 'unknown')
  assert.equal(toLeadType('　'), 'unknown') // 全角空白（NFKC で半角化され trim される）
  assert.equal(toLeadType(null), 'unknown')
  assert.equal(toLeadType(undefined), 'unknown')
})

test('辞書に無い値は unknown（⛔ 部分一致・前方一致で拾わない）', () => {
  // 「買主」を含むが完全一致ではない値を buy に落とさない（O49）。
  assert.equal(toLeadType('買主希望'), 'unknown')
  assert.equal(toLeadType('見込買主'), 'unknown')
  assert.equal(toLeadType('売主様'), 'unknown')
  assert.equal(toLeadType('買'), 'unknown')
  assert.equal(toLeadType('法人'), 'unknown')
  assert.equal(toLeadType('賃貸'), 'unknown')
})

test('前後の空白は trim して判定する', () => {
  assert.equal(toLeadType(' 買主 '), 'buy')
  assert.equal(toLeadType('\t売主\n'), 'sell')
  assert.equal(toLeadType('　買主　'), 'buy') // 全角空白のみが前後に付いた場合
})

test('NFKC 正規化で全角/半角・互換文字の揺れを吸収する', () => {
  // 互換文字（合成済み）で書かれた '買主' も同一視される。
  assert.equal(toLeadType('買主'.normalize('NFD')), 'buy')
  // 英数字の全角は NFKC で半角化される（辞書に無いので unknown のまま）。
  assert.equal(toLeadType('ＢＵＹ'), 'unknown')
})

test('countLeadTypes は 3 値の件数に畳む（個票は持たない）', () => {
  const types: LeadType[] = ['buy', 'buy', 'sell', 'unknown', 'buy']
  assert.deepEqual(countLeadTypes(types), { buy: 3, sell: 1, unknown: 1 })
  assert.deepEqual(countLeadTypes([]), { buy: 0, sell: 0, unknown: 0 })
})

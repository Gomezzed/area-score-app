// toMuniCode6 のユニットテスト（依存ゼロ・Node 標準テストランナー）。
//   実行: npm test  （= node --test src/lib/muni-code.test.ts）
//   Node はネイティブで .ts を型ストリップ実行するため追加依存は不要。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toMuniCode6 } from './muni-code.ts'

// 実測突合済の 5→6 桁（JIS X 0402 検査数字）。本番DB と一致。
const CASES: Array<[string, string]> = [
  ['35208', '352080'], // 岩国市
  ['28214', '282146'], // 宝塚市
  ['46201', '462012'], // 鹿児島市
  ['28100', '281000'], // 神戸市
  // 神戸各区（281xx 系）
  ['28101', '281018'], // 東灘区
  ['28102', '281026'], // 灘区
  ['28105', '281051'], // 兵庫区
  ['28110', '281107'], // 中央区
  ['28111', '281115'], // 西区
]

test('5桁 JIS → 6桁（検査数字付与）', () => {
  for (const [in5, out6] of CASES) {
    assert.equal(toMuniCode6(in5), out6, `${in5} → ${out6}`)
  }
})

test('既に6桁ならそのまま返す（冪等）', () => {
  assert.equal(toMuniCode6('352080'), '352080')
  assert.equal(toMuniCode6('462012'), '462012')
})

test('数値入力も受け付ける', () => {
  assert.equal(toMuniCode6(35208), '352080')
})

test('不正・欠損入力は null', () => {
  assert.equal(toMuniCode6(null), null)
  assert.equal(toMuniCode6(undefined), null)
  assert.equal(toMuniCode6(''), null)
  assert.equal(toMuniCode6('3520'), null) // 4桁
  assert.equal(toMuniCode6('3520800'), null) // 7桁
  assert.equal(toMuniCode6('abcde'), null) // 非数字
})

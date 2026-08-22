// 顧客名簿の削除導線（O86）の純ロジックのユニットテスト。依存ゼロ・DB/React 不要。
//   表示可否判定（is_owner）・確認ダイアログの文言組み立て・削除エラーの日本語化を固定する。
//   ⚠ React コンポーネント（ダイアログの開閉・キャンセルで未実行）は node --test では
//      検証できない（jsdom/testing-library 非導入）。ここでは分岐の純ロジックを固定し、
//      「is_owner=false で非表示」「成功時の一覧更新の入力判定」に相当する部分を担保する。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canDeleteList,
  describeListForDelete,
  mapDeleteError,
} from './delete-ui.ts'

// ── canDeleteList：is_owner=false では削除ボタンを出さない（表示上のヒント）──
test('canDeleteList: is_owner=true のみ true（false は非表示）', () => {
  assert.equal(canDeleteList(true), true)
  assert.equal(canDeleteList(false), false)
})

test('canDeleteList: 真偽以外の値は厳密に false（=== true 判定）', () => {
  // 型の隙間（undefined 等）が来ても削除ボタンを出さない安全側に倒す。
  assert.equal(canDeleteList(undefined as unknown as boolean), false)
  assert.equal(canDeleteList(1 as unknown as boolean), false)
})

// ── describeListForDelete：確認ダイアログの提示文言 ──
test('describeListForDelete: 取込済みは件数を桁区切りで表示', () => {
  const r = describeListForDelete({ name: '2026年8月 反響顧客', rowCount: 1234 })
  assert.equal(r.name, '2026年8月 反響顧客')
  assert.equal(r.rowsLabel, '1,234件')
})

test('describeListForDelete: row_count=0（未取込）は「未取込（0件）」', () => {
  const r = describeListForDelete({ name: '空リスト', rowCount: 0 })
  assert.equal(r.rowsLabel, '未取込（0件）')
})

test('describeListForDelete: 名前が空白のみなら代替名にフォールバック', () => {
  assert.equal(describeListForDelete({ name: '   ', rowCount: 5 }).name, '（無題のリスト）')
  assert.equal(describeListForDelete({ name: '', rowCount: 5 }).name, '（無題のリスト）')
})

test('describeListForDelete: 前後の空白はトリムする', () => {
  assert.equal(describeListForDelete({ name: '  リストA  ', rowCount: 1 }).name, 'リストA')
})

// ── mapDeleteError：D49 エンベロープの code / HTTP から日本語文言へ ──
test('mapDeleteError: not_found は「対象が見つかりません」系', () => {
  const msg = mapDeleteError('not_found', 404)
  assert.match(msg, /見つかりません/)
})

test('mapDeleteError: delete_failed は再試行を促す文言', () => {
  assert.match(mapDeleteError('delete_failed', 500), /失敗しました/)
})

test('mapDeleteError: 403 は Platinum 限定の案内', () => {
  assert.match(mapDeleteError(undefined, 403), /Platinum/)
})

test('mapDeleteError: 401 はログイン要求', () => {
  assert.match(mapDeleteError(undefined, 401), /ログイン/)
})

test('mapDeleteError: code 無し 404 でも「見つかりません」系にフォールバック', () => {
  assert.match(mapDeleteError(undefined, 404), /見つかりません/)
})

test('mapDeleteError: 未知の code / その他ステータスは汎用の失敗文言', () => {
  assert.match(mapDeleteError('weird', 500), /失敗しました/)
})

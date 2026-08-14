// CSV パース & 列マッピング自動検出のユニットテスト（依存ゼロ）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCsv,
  detectColumnMapping,
  cellOf,
  parseDateLoose,
} from './csv-import.ts'

const HEADER = ['反響日時', '顧客名', '反響媒体', '住所', '電話', '最終接触日', '種別', '担当']

test('parseCsv: BOM/CRLF/引用符内カンマ/"" エスケープ', () => {
  const csv =
    '﻿a,b,c\r\n' + // BOM + CRLF
    '"愛知県岡崎市稲熊町3-1, ハイツ101",山田,"090"\n' +
    'x,"引用符""内",z\n'
  const rows = parseCsv(csv)
  assert.equal(rows.length, 3)
  assert.deepEqual(rows[0], ['a', 'b', 'c'])
  assert.deepEqual(rows[1], ['愛知県岡崎市稲熊町3-1, ハイツ101', '山田', '090'])
  assert.deepEqual(rows[2], ['x', '引用符"内', 'z'])
})

test('detectColumnMapping: 8列すべてを論理列へ対応づけ', () => {
  const m = detectColumnMapping(HEADER)
  assert.equal(m.inquiry_at, 0)
  assert.equal(m.customer_name, 1)
  assert.equal(m.media, 2)
  assert.equal(m.address, 3)
  assert.equal(m.phone, 4)
  assert.equal(m.last_contact_at, 5)
  assert.equal(m.category, 6)
  assert.equal(m.assignee, 7)
})

test('detectColumnMapping: 列順が違っても住所を検出', () => {
  const m = detectColumnMapping(['お名前', 'ご住所', 'TEL'])
  assert.equal(m.customer_name, 0)
  assert.equal(m.address, 1)
  assert.equal(m.phone, 2)
})

test('cellOf: マッピング経由で値を取得（欠損列は空文字）', () => {
  const m = detectColumnMapping(HEADER)
  const row = ['2026/08/01', '山田太郎', 'SUUMO', '岡崎市稲熊町3-1', '090-0000-0000', '2026/08/05', '売却', '田中']
  assert.equal(cellOf(row, m, 'customer_name'), '山田太郎')
  assert.equal(cellOf(row, m, 'address'), '岡崎市稲熊町3-1')
})

test('parseDateLoose: 各種表記 → ISO / 不正は null', () => {
  assert.equal(parseDateLoose('2026/08/01'), '2026-08-01T00:00:00Z')
  assert.equal(parseDateLoose('2026-8-1'), '2026-08-01T00:00:00Z')
  assert.equal(parseDateLoose('2026年8月5日'), '2026-08-05T00:00:00Z')
  assert.equal(parseDateLoose('2026/08'), '2026-08-01T00:00:00Z')
  assert.equal(parseDateLoose(''), null)
  assert.equal(parseDateLoose('不明'), null)
})

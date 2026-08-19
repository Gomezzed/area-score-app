// 行抽出（external_id の文字列維持・日付の NULL 化＋根拠・PII 読み捨て）のユニットテスト。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseCsv, detectColumnMapping } from './csv-import.ts'
import { extractRows, EXTRACT_KEYS, DISCARDED_KEYS } from './row-extract.ts'

// 架空のフィクスチャ（ハウスドゥ形式のヘッダ 174 列・データ 1 行）。
//   ⛔ 顧客の生データではない。docs/specs 配下の架空データのみを使う。
const FIXTURE_PATH = new URL(
  '../../../docs/specs/hausudo_customer_headers_fixture_v1.csv',
  import.meta.url,
)

test('extractRows: 顧客番号はゼロ落ち・指数表記化させず文字列のまま保持する', () => {
  const csv =
    '顧客番号,住所\n' +
    '0009990001,岡崎市稲熊町3-1\n' +
    '9999999999999999999,岡崎市稲熊町3-2\n' +
    '1e5,岡崎市稲熊町3-3\n'
  const rows = parseCsv(csv)
  const out = extractRows(rows.slice(1), detectColumnMapping(rows[0]))

  assert.equal(out[0].external_id, '0009990001') // 先頭ゼロが落ちない
  assert.equal(out[1].external_id, '9999999999999999999') // 精度落ちしない
  assert.equal(out[2].external_id, '1e5') // 指数表記として解釈されない
  for (const r of out) assert.equal(typeof r.external_id, 'string')
})

test('extractRows: 空の顧客番号は null（＝追跡不能行として UPSERT 対象外にする）', () => {
  const csv = '顧客番号,住所\n,岡崎市稲熊町3-1\n   ,岡崎市稲熊町3-2\n'
  const rows = parseCsv(csv)
  const out = extractRows(rows.slice(1), detectColumnMapping(rows[0]))
  assert.equal(out[0].external_id, null)
  assert.equal(out[1].external_id, null)
})

test('extractRows: 未知の日付書式は推測せず null にし reason を残す（原則1）', () => {
  const csv =
    '反響日,最終接触日,住所\n' +
    '2026/08/01,2026年8月5日,岡崎市稲熊町3-1\n' +
    '不明,2026/02/30,岡崎市稲熊町3-2\n'
  const rows = parseCsv(csv)
  const out = extractRows(rows.slice(1), detectColumnMapping(rows[0]))

  assert.equal(out[0].inquiry_at, '2026-08-01T00:00:00Z')
  assert.equal(out[0].last_contact_at, '2026-08-05T00:00:00Z')
  assert.deepEqual(out[0].reasons, [])

  // 読めない値・暦として存在しない日付はどちらも null。理由は区別して残す。
  assert.equal(out[1].inquiry_at, null)
  assert.equal(out[1].last_contact_at, null)
  assert.deepEqual(out[1].reasons, [
    'inquiry_at:date_unparsed',
    'last_contact_at:date_invalid',
  ])
})

test('extractRows: PII 列は ExtractedRow のキーにも値にも現れない（CL-32）', () => {
  const csv =
    '顧客名,顧客名フリガナ,電話番号,メールアドレス,生年月日,住所\n' +
    '架空太郎,カクウタロウ,090-1234-5678,himitsu@example.com,1990/01/01,岡崎市稲熊町3-1\n'
  const rows = parseCsv(csv)
  const out = extractRows(rows.slice(1), detectColumnMapping(rows[0]))

  // 氏名のみ保持（CL-32: アタックリストは「誰に架電するか」を出す画面）。
  assert.equal(out[0].customer_name, '架空太郎')

  // キーとして存在しない。
  assert.ok(!('phone' in out[0]))
  assert.ok(!('email' in out[0]))
  assert.ok(!('kana' in out[0]))
  for (const key of DISCARDED_KEYS) assert.ok(!EXTRACT_KEYS.includes(key))

  // 値としても一切到達しない（シリアライズ全文に現れない＝変数に保持していない）。
  const serialized = JSON.stringify(out)
  assert.ok(!serialized.includes('090-1234-5678'))
  assert.ok(!serialized.includes('himitsu@example.com'))
  assert.ok(!serialized.includes('カクウタロウ'))
})

test('extractRows: 174列の架空フィクスチャを流しても落ちず、顧客番号とPII方針を守る', () => {
  // ⚠ 本 PR ではこのフィクスチャを「エンコーディング / external_id の文字列維持 /
  //    PII 読み捨て」の検証にのみ使う。ハウスドゥ形式の列マッピング精度は PR-C の責務で、
  //    ここでは主張しない（v0 のキーワード検出は 174 列に対して誤検出する）。
  const csv = readFileSync(FIXTURE_PATH, 'utf8')
  const rows = parseCsv(csv)
  assert.equal(rows[0].length, 174)

  const out = extractRows(rows.slice(1), detectColumnMapping(rows[0]))
  assert.equal(out.length, 1)
  assert.equal(out[0].external_id, '9990001')
  assert.equal(typeof out[0].external_id, 'string')

  const serialized = JSON.stringify(out)
  assert.ok(!serialized.includes('test@example.com')) // メールアドレス
  assert.ok(!serialized.includes('カクウ')) // フリガナ
  assert.ok(!serialized.includes('000-0000-0000')) // 電話番号
})

// CSV バイト列デコード（O44: UTF-8 / cp932）のユニットテスト（依存ゼロ）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeCsvBytes, CsvDecodeError } from './decode.ts'

// '住所\n愛知県岡崎市\n' を cp932 でエンコードしたバイト列（Python cp932 で生成）。
//   先頭 0x8f は UTF-8 としては不正な継続バイトなので、fatal:true の UTF-8 は必ず失敗する。
const CP932_BYTES = new Uint8Array([
  0x8f, 0x5a, 0x8f, 0x8a, 0x0a, 0x88, 0xa4, 0x92, 0x6d, 0x8c, 0xa7, 0x89, 0xaa, 0x8d,
  0xe8, 0x8e, 0x73, 0x0a,
])

test('decodeCsvBytes: UTF-8（BOM 無し）', () => {
  const bytes = new TextEncoder().encode('住所\n愛知県岡崎市\n')
  const r = decodeCsvBytes(bytes)
  assert.equal(r.encoding, 'utf-8')
  assert.equal(r.text, '住所\n愛知県岡崎市\n')
})

test('decodeCsvBytes: UTF-8 BOM 付きは utf-8-bom として検出', () => {
  // ⚠ BOM は不可視文字なので、文字列リテラルに埋めず **バイトで明示** して連結する
  //    （ソース上で BOM 無しの場合と見分けが付かなくなるのを防ぐ）。
  const body = new TextEncoder().encode('住所\n愛知県岡崎市\n')
  const bytes = new Uint8Array(3 + body.length)
  bytes.set([0xef, 0xbb, 0xbf], 0)
  bytes.set(body, 3)
  const r = decodeCsvBytes(bytes)
  assert.equal(r.encoding, 'utf-8-bom')
  // BOM は文字列先頭に残る（parseCsv 側で除去される）。本文は復元できている。
  assert.ok(r.text.includes('愛知県岡崎市'))
})

test('decodeCsvBytes: cp932(Shift_JIS) へフォールバックして復元できる', () => {
  const r = decodeCsvBytes(CP932_BYTES)
  assert.equal(r.encoding, 'shift_jis')
  assert.equal(r.text, '住所\n愛知県岡崎市\n')
})

test('decodeCsvBytes: UTF-16 は推測せず CsvDecodeError で弾く', () => {
  const bytes = new Uint8Array([0xff, 0xfe, 0x4f, 0x4f])
  assert.throws(
    () => decodeCsvBytes(bytes),
    (e: unknown) => e instanceof CsvDecodeError && e.code === 'unsupported_encoding',
  )
})

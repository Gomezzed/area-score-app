// 住所→町域 突合エンジンのユニットテスト（依存ゼロ・Node 標準テストランナー）。
//   実行: npm test （= node --test 'src/**/*.test.ts'）
//   Node はネイティブで .ts を型ストリップ実行するため追加依存は不要。
//
//   テスト町名は岡崎市の実在町域名（稲熊町・羽根町・明大寺町・蓑川新町・大平町・
//   桜形町・明大寺本町）を用い、表記ゆれ（丁目の全角/半角・番地付き・旧字体・
//   「大字/字」・ハイフン各種・空白）を網羅する。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTownIndex, matchAddress } from './match.ts'
import { normalizeAddress } from './normalize.ts'
import type { TownRecord } from './types.ts'

const OKAZAKI = '11111111-1111-1111-1111-111111111111'

// 岡崎市の実在町域名でマスタを構成（town_id は連番のダミー）。
//   末尾2件（原）は「同名異町域」を再現するため office_name 違いで2行にした
//   合成ケース（原則3: office_name で一意化／ambiguous 分岐の検証用）。
function rec(town_id: number, town_name: string, office_name: string | null = null): TownRecord {
  return {
    municipality_id: OKAZAKI,
    municipality_name: '岡崎市',
    town_id,
    town_name,
    town_name_raw: town_name,
    office_name,
  }
}

const RECORDS: TownRecord[] = [
  rec(1, '稲熊町'),
  rec(2, '羽根町'),
  rec(3, '明大寺町'),
  rec(4, '明大寺本町'), // 明大寺町 との最長prefix競合の検証用
  rec(5, '蓑川新町'),
  rec(6, '大平町'),
  rec(7, '桜形町'), // 旧字体（櫻）検証用
  // 同名異町域（合成）: 「原」が出張所違いで2件 → ambiguous
  rec(8, '原', '本所'),
  rec(9, '原', '東部支所'),
]

const index = buildTownIndex(RECORDS)

test('confirmed: 都道府県+市+丁目+番地（半角）', () => {
  const r = matchAddress('愛知県岡崎市稲熊町3丁目1-2', index)
  assert.equal(r.status, 'confirmed')
  assert.equal(r.municipality_id, OKAZAKI)
  assert.equal(r.town_name_normalized, '稲熊町')
})

test('confirmed: 丁目の全角数字（NFKC 半角化）', () => {
  const r = matchAddress('岡崎市稲熊町３丁目', index)
  assert.equal(r.status, 'confirmed')
  assert.equal(r.town_name_normalized, '稲熊町')
})

test('confirmed: 「字」接頭辞の除去（羽根町字前田）', () => {
  const r = matchAddress('岡崎市羽根町字前田123', index)
  assert.equal(r.status, 'confirmed')
  assert.equal(r.town_name_normalized, '羽根町')
})

test('confirmed: 最長prefix（明大寺本町 を 明大寺町 に誤マッチしない）', () => {
  const r = matchAddress('岡崎市明大寺本町2-3', index)
  assert.equal(r.status, 'confirmed')
  assert.equal(r.town_name_normalized, '明大寺本町')
})

test('confirmed: 明大寺町（本町でない側）も正しく確定', () => {
  const r = matchAddress('岡崎市明大寺町1-1', index)
  assert.equal(r.status, 'confirmed')
  assert.equal(r.town_name_normalized, '明大寺町')
})

test('confirmed: 旧字体（櫻形町 → 桜形町）', () => {
  const r = matchAddress('岡崎市櫻形町10', index)
  assert.equal(r.status, 'confirmed')
  assert.equal(r.town_name_normalized, '桜形町')
})

test('confirmed: 空白除去（全角/半角混在）', () => {
  const r = matchAddress('愛知県 岡崎市　蓑川新町 12-3', index)
  assert.equal(r.status, 'confirmed')
  assert.equal(r.town_name_normalized, '蓑川新町')
})

test('confirmed: ハイフン各種（em dash / 全角）を吸収', () => {
  const r = matchAddress('岡崎市大平町字○１—２', index)
  assert.equal(r.status, 'confirmed')
  assert.equal(r.town_name_normalized, '大平町')
})

test('ambiguous: 同名異町域（原×2）は候補を保持し断定しない', () => {
  const r = matchAddress('岡崎市原1-2', index)
  assert.equal(r.status, 'ambiguous')
  assert.equal(r.municipality_id, OKAZAKI)
  assert.equal(r.town_name_normalized, null)
  assert.equal(r.candidates.length, 2)
  const offices = new Set(r.candidates.map((c) => c.office_name))
  assert.ok(offices.has('本所') && offices.has('東部支所'))
})

test('out_of_scope: 市区町村がスコープ外（名古屋市）', () => {
  const r = matchAddress('愛知県名古屋市中区栄3-1-1', index)
  assert.equal(r.status, 'out_of_scope')
  assert.equal(r.municipality_id, null)
  assert.equal(r.town_name_normalized, null)
})

test('out_of_scope: 市は判るが町域がマスタ未整備', () => {
  const r = matchAddress('岡崎市存在しない架空町5-5', index)
  assert.equal(r.status, 'out_of_scope')
  assert.equal(r.municipality_id, OKAZAKI) // 市区町村は特定できている
  assert.equal(r.town_name_normalized, null)
  assert.equal(r.candidates.length, 0)
})

test('out_of_scope: 空文字・欠損住所', () => {
  assert.equal(matchAddress('', index).status, 'out_of_scope')
  assert.equal(matchAddress(null, index).status, 'out_of_scope')
  assert.equal(matchAddress(undefined, index).status, 'out_of_scope')
})

test('normalizeAddress: 旧字体/ハイフン/大字・字/空白の吸収', () => {
  assert.equal(normalizeAddress('　愛知県 岡崎市 大字稲熊町 ３—１ '), '愛知県岡崎市稲熊町3-1')
  assert.equal(normalizeAddress('髙﨑町１'), '高崎町1') // 旧字体2種 + 全角数字
})

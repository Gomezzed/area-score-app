// ============================================================
// S3 都道府県アンカーの検証（ambiguous を確実に発火させる回帰テスト）。
//   実行: npm test （= node --test 'src/**/*.test.ts'）
//
//   本番で ambiguous は0件・未発火のため、この経路を初めて検証する。
//   ダミーCSV（fixtures/ambiguous-sample.csv）を import 経路と同じ手順
//   （parseCsv → detectColumnMapping → matchAddress）で突合し:
//     ① 都道府県を省略した「府中市○○町」が ambiguous になること（本機能の要）
//     ② 都道府県アンカーで東京/広島の府中市を取り違えないこと
//     ③ 既存の突合結果（岡崎 confirmed / 豊田・名古屋市中区 out_of_scope）が
//        都道府県アンカー導入後も変わらないこと
// ============================================================
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildTownIndex, matchAddress } from './match.ts'
import { parseCsv, detectColumnMapping, cellOf } from './csv-import.ts'
import type { TownRecord } from './types.ts'

// 実在の自治体を模した id（UUID 形式のダミー）。prefecture_code は seed 準拠。
const OKAZAKI = '11111111-1111-1111-1111-111111111111' // 愛知(23)・町域データ有り
const TOYOTA = '22222222-2222-2222-2222-222222222222' // 愛知(23)・町域データ無し
const NAGOYA_NAKA = '33333333-3333-3333-3333-333333333333' // 愛知(23)・町域データ無し
const FUCHU_TOKYO = '44444444-4444-4444-4444-444444444444' // 東京(13)・町域データ無し
const FUCHU_HIROSHIMA = '55555555-5555-5555-5555-555555555555' // 広島(34)・町域データ無し

// 岡崎市の実在町域（confirmed 検証用）。他自治体は町域データを持たない。
function okazakiTown(town_id: number, town_name: string): TownRecord {
  return {
    municipality_id: OKAZAKI,
    municipality_name: '岡崎市',
    town_id,
    town_name,
    town_name_raw: town_name,
    office_name: null,
  }
}

const RECORDS: TownRecord[] = [
  okazakiTown(1, '稲熊町'),
  okazakiTown(2, '羽根町'),
  okazakiTown(3, '明大寺町'),
  okazakiTown(4, '明大寺本町'),
  okazakiTown(5, '蓑川新町'),
  okazakiTown(6, '大平町'),
  okazakiTown(7, '桜形町'),
  okazakiTown(8, '材木町'),
]

// 解決母集合（＝municipalities テーブル相当）。prefecture_code を持たせて
// 都道府県アンカーを効かせる。府中市は東京・広島の2件（同名）。
const ALL_MUNIS = [
  { id: OKAZAKI, name: '岡崎市', prefecture_code: '23' },
  { id: TOYOTA, name: '豊田市', prefecture_code: '23' },
  { id: NAGOYA_NAKA, name: '名古屋市中区', prefecture_code: '23' },
  { id: FUCHU_TOKYO, name: '府中市', prefecture_code: '13' },
  { id: FUCHU_HIROSHIMA, name: '府中市', prefecture_code: '34' },
]

const index = buildTownIndex(RECORDS, ALL_MUNIS)

// import 経路と同じ手順で CSV を突合する。
function matchFixture() {
  const csv = readFileSync(
    new URL('./fixtures/ambiguous-sample.csv', import.meta.url),
    'utf8',
  )
  const rows = parseCsv(csv)
  const header = rows[0]
  const mapping = detectColumnMapping(header)
  assert.ok(mapping.address != null, '住所列が検出できること')
  return rows.slice(1).map((row) => {
    const address = cellOf(row, mapping, 'address')
    return { address, result: matchAddress(address, index) }
  })
}

test('要: 都道府県省略の「府中市○○町」は ambiguous（断定しない）', () => {
  const matched = matchFixture()
  const ambiguous = matched.filter((m) => m.result.status === 'ambiguous')
  // ダミーCSVには ambiguous が必ず1件以上含まれる。
  assert.ok(ambiguous.length >= 1, 'ambiguous が1件以上発火すること')

  // 「府中市宮西町1-1」（都道府県省略）が当該行。
  const row = matched.find((m) => m.address === '府中市宮西町1-1')
  assert.ok(row, '対象行が存在すること')
  assert.equal(row!.result.status, 'ambiguous')
  // 一意に定まらないので市区町村は確定しない。
  assert.equal(row!.result.municipality_id, null)
  assert.equal(row!.result.town_name_normalized, null)
  // 候補として東京・広島の府中市が両方保持される（どの府中市か＝ユーザー確認用）。
  assert.equal(row!.result.candidates.length, 2)
  const prefs = new Set(row!.result.candidates.map((c) => c.prefecture_code))
  assert.ok(prefs.has('13') && prefs.has('34'), '東京(13)・広島(34)が候補')
  const munis = new Set(row!.result.candidates.map((c) => c.municipality_id))
  assert.ok(munis.has(FUCHU_TOKYO) && munis.has(FUCHU_HIROSHIMA))
})

test('都道府県アンカー: 東京/広島の府中市を取り違えない', () => {
  const matched = matchFixture()
  // 東京都府中市 → 東京の府中市に一意解決（町域データ無しなので out_of_scope）。
  const tokyo = matched.find((m) => m.address === '東京都府中市宮西町2-2')!
  assert.equal(tokyo.result.status, 'out_of_scope')
  assert.equal(tokyo.result.municipality_id, FUCHU_TOKYO)

  // 広島県府中市 → 広島の府中市に一意解決（同上）。
  const hiroshima = matched.find((m) => m.address === '広島県府中市元町1-1')!
  assert.equal(hiroshima.result.status, 'out_of_scope')
  assert.equal(hiroshima.result.municipality_id, FUCHU_HIROSHIMA)
})

test('回帰: 岡崎=confirmed / 豊田・名古屋市中区=out_of_scope は不変', () => {
  const matched = matchFixture()
  const summary = { confirmed: 0, ambiguous: 0, out_of_scope: 0 }
  for (const m of matched) summary[m.result.status]++

  // 岡崎の8行はすべて confirmed（表記ゆれ・都道府県有無を跨いで）。
  assert.equal(summary.confirmed, 8, '岡崎8件が confirmed')

  // 豊田・名古屋市中区は町域データ未整備で out_of_scope（市区町村は特定できる）。
  const toyota = matched.find((m) => m.address === '愛知県豊田市西町3-1')!
  assert.equal(toyota.result.status, 'out_of_scope')
  assert.equal(toyota.result.municipality_id, TOYOTA)

  const nagoya = matched.find((m) => m.address === '愛知県名古屋市中区栄3-1-1')!
  assert.equal(nagoya.result.status, 'out_of_scope')
  assert.equal(nagoya.result.municipality_id, NAGOYA_NAKA)
})

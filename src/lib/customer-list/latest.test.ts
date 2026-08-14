// 「自治体ごとの最新 as_of」抽出のユニットテスト（依存ゼロ）。
//   レビュー指摘の回帰（グローバル最大月方式）を検知する。
//   最新月が異なる2自治体（岡崎=2026-06 / 刈谷=2026-07）のレコードを混在させ、
//   自治体別最新月方式なら両自治体とも confirmed で突合できることを確認する。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { latestPerMunicipality } from './latest.ts'
import { buildTownIndex, matchAddress } from './match.ts'
import type { TownRecord } from './types.ts'

const OKAZAKI = '11111111-1111-1111-1111-111111111111' // 実測 最新 2026-06-01
const KARIYA = '22222222-2222-2222-2222-222222222222' // 実測 最新 2026-07-01

// ビュー相当の生行（town 識別 + as_of）。岡崎/刈谷それぞれ最新月と旧月を混在。
interface Row extends TownRecord {
  as_of: string
}
function row(
  municipality_id: string,
  municipality_name: string,
  town_id: number,
  town_name: string,
  as_of: string,
): Row {
  return {
    municipality_id,
    municipality_name,
    town_id,
    town_name,
    town_name_raw: town_name,
    office_name: null,
    as_of,
  }
}

const RAW: Row[] = [
  // 岡崎: 最新 2026-06、旧 2026-05
  row(OKAZAKI, '岡崎市', 1, '稲熊町', '2026-06-01'),
  row(OKAZAKI, '岡崎市', 1, '稲熊町', '2026-05-01'),
  row(OKAZAKI, '岡崎市', 2, '羽根町', '2026-06-01'),
  // 刈谷: 最新 2026-07、旧 2026-04
  row(KARIYA, '刈谷市', 10, '一ツ木町', '2026-07-01'),
  row(KARIYA, '刈谷市', 10, '一ツ木町', '2026-04-01'),
]

test('latestPerMunicipality: 自治体別に最新月の行のみ残す', () => {
  const latest = latestPerMunicipality(
    RAW,
    (r) => r.municipality_id,
    (r) => r.as_of,
  )
  // 岡崎 2026-06 の2件（稲熊町・羽根町）＋刈谷 2026-07 の1件（一ツ木町）＝ 計3件。
  assert.equal(latest.length, 3)
  assert.ok(latest.every((r) => r.as_of === '2026-06-01' || r.as_of === '2026-07-01'))
  // 旧月（2026-05 / 2026-04）は残らない。
  assert.ok(!latest.some((r) => r.as_of === '2026-05-01' || r.as_of === '2026-04-01'))
})

test('自治体別最新月: 岡崎・刈谷とも confirmed で突合できる', () => {
  const latest = latestPerMunicipality(
    RAW,
    (r) => r.municipality_id,
    (r) => r.as_of,
  )
  const index = buildTownIndex(latest)

  const okazaki = matchAddress('愛知県岡崎市稲熊町3丁目1-2', index)
  assert.equal(okazaki.status, 'confirmed')
  assert.equal(okazaki.municipality_id, OKAZAKI)
  assert.equal(okazaki.town_name_normalized, '稲熊町')

  const kariya = matchAddress('愛知県刈谷市一ツ木町2-2', index)
  assert.equal(kariya.status, 'confirmed')
  assert.equal(kariya.municipality_id, KARIYA)
  assert.equal(kariya.town_name_normalized, '一ツ木町')
})

test('回帰の可視化: グローバル最大月方式だと岡崎が全滅する', () => {
  // わざとグローバル最大月（2026-07）で絞ると、岡崎（最新2026-06）の行が0件になり、
  // 岡崎の住所は out_of_scope に落ちる＝主用途が全滅する（この方式は誤り）。
  const globalMax = RAW.reduce((mx, r) => (r.as_of > mx ? r.as_of : mx), '')
  assert.equal(globalMax, '2026-07-01')
  const globalOnly = RAW.filter((r) => r.as_of === globalMax)
  const badIndex = buildTownIndex(globalOnly)
  const okazaki = matchAddress('愛知県岡崎市稲熊町3丁目1-2', badIndex)
  assert.equal(okazaki.status, 'out_of_scope') // ← 自治体別最新月方式で解消される
})

// 自治体解決を municipalities（全市区町村）由来にした修正のユニットテスト。
//   タイムアウト・ホットフィックス: 対象外の市（町域データ無し）でも
//   住所から municipality_id を確定・保持できることを確認する。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildTownIndex,
  matchAddress,
  resolveMunicipalityId,
} from './match.ts'
import type { TownRecord } from './types.ts'

const OKAZAKI = '11111111-1111-1111-1111-111111111111' // 町域データ有り
const TOYOTA = '33333333-3333-3333-3333-333333333333' // 町域データ無し（対象外の市）

// 町域データ（records）は岡崎のみ。豊田は町域データを持たない。
const RECORDS: TownRecord[] = [
  {
    municipality_id: OKAZAKI,
    municipality_name: '岡崎市',
    town_id: 1,
    town_name: '稲熊町',
    town_name_raw: '稲熊町',
    office_name: null,
  },
]
// 自治体解決の母集合（＝municipalities テーブル相当）は岡崎＋豊田の両方。
const ALL_MUNIS = [
  { id: OKAZAKI, name: '岡崎市' },
  { id: TOYOTA, name: '豊田市' },
]
const index = buildTownIndex(RECORDS, ALL_MUNIS)

test('対象外の市（豊田）でも municipality_id を保持し out_of_scope', () => {
  const r = matchAddress('愛知県豊田市西町3-1', index)
  assert.equal(r.status, 'out_of_scope')
  assert.equal(r.municipality_id, TOYOTA) // 町域データは無いが市は確定できる
  assert.equal(r.town_name_normalized, null)
  assert.equal(r.candidates.length, 0)
})

test('resolveMunicipalityId: 全 municipalities から最長一致で id を返す', () => {
  assert.equal(resolveMunicipalityId('愛知県豊田市西町3-1', index), TOYOTA)
  assert.equal(resolveMunicipalityId('愛知県岡崎市稲熊町3-1', index), OKAZAKI)
  // 母集合に無い市は null（＝解決不可）。
  assert.equal(resolveMunicipalityId('東京都千代田区丸の内1-1', index), null)
  assert.equal(resolveMunicipalityId('', index), null)
})

test('町域データのある岡崎は従来どおり confirmed', () => {
  const r = matchAddress('愛知県岡崎市稲熊町3丁目1-2', index)
  assert.equal(r.status, 'confirmed')
  assert.equal(r.municipality_id, OKAZAKI)
  assert.equal(r.town_name_normalized, '稲熊町')
})

test('override 省略時は従来どおり records 由来で解決（後方互換）', () => {
  const legacy = buildTownIndex(RECORDS) // allMunicipalities 省略
  // 豊田は records に無い＝解決不可（municipality_id も付かない）。
  const toyota = matchAddress('愛知県豊田市西町3-1', legacy)
  assert.equal(toyota.status, 'out_of_scope')
  assert.equal(toyota.municipality_id, null)
  // 岡崎は従来どおり confirmed。
  assert.equal(matchAddress('岡崎市稲熊町1-1', legacy).status, 'confirmed')
})

// 毎回全件 UPSERT の計画づくり（主キー UPSERT 方式）のユニットテスト。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planUpsert } from './upsert-plan.ts'
import type { ExtractedRow } from './row-extract.ts'
import type { MatchResult } from './types.ts'

const LIST = '11111111-1111-1111-1111-111111111111'
const USER = '22222222-2222-2222-2222-222222222222'

// 決定的な採番（テストから注入する）。
function counter() {
  let n = 0
  return () => `new-${++n}`
}

function row(row_no: number, external_id: string | null): ExtractedRow {
  return {
    row_no,
    external_id,
    customer_name: `顧客${row_no}`,
    address_raw: '岡崎市稲熊町3-1',
    inquiry_at: null,
    last_contact_at: null,
    media: null,
    category: null,
    assignee: null,
    desired_school: null,
    desired_muni_code_5: null,
    lead_type: 'unknown',
    property_types: [],
    desired_floor_area_min: null,
    desired_floor_area_max: null,
    desired_land_area_min: null,
    desired_land_area_max: null,
    reasons: [],
  }
}

const MATCH: MatchResult = {
  status: 'out_of_scope',
  municipality_id: null,
  town_name_normalized: null,
  candidates: [],
  address_normalized: '岡崎市稲熊町3-1',
}

test('planUpsert: 既存 external_id は既存の行 id を再利用し、新規は採番する', () => {
  const extracted = [row(1, 'A001'), row(2, 'B002')]
  const plan = planUpsert({
    listId: LIST,
    userId: USER,
    extracted,
    matches: [MATCH, MATCH],
    existingByExternalId: new Map([['A001', 'existing-a']]),
    newId: counter(),
  })

  assert.equal(plan.tracked.length, 2)
  assert.equal(plan.tracked[0].id, 'existing-a') // UPDATE 側へ回る
  assert.equal(plan.tracked[1].id, 'new-1') // INSERT 側へ回る
  assert.equal(plan.untracked.length, 0)
  // 再出現した行は missing_since を必ず消す（PR-A 申し送り②）。
  for (const r of plan.tracked) assert.equal(r.missing_since, null)
  assert.equal(plan.tracked[0].list_id, LIST)
  assert.equal(plan.tracked[0].user_id, USER)
})

test('planUpsert: CSV 内で顧客番号が重複したら後勝ちで 1 行に畳む', () => {
  const extracted = [row(1, 'A001'), row(2, 'A001'), row(3, 'C003')]
  const plan = planUpsert({
    listId: LIST,
    userId: USER,
    extracted,
    matches: [MATCH, MATCH, MATCH],
    existingByExternalId: new Map(),
    newId: counter(),
  })

  assert.equal(plan.tracked.length, 2)
  assert.equal(plan.tracked[0].external_id, 'A001')
  assert.equal(plan.tracked[0].row_no, 2) // 後勝ち（2 行目の内容が残る）
  assert.equal(plan.tracked[0].customer_name, '顧客2')
  assert.equal(plan.tracked[0].id, 'new-1') // id は最初に採番したものを流用（重複採番しない）
  assert.deepEqual(plan.dedupedExternalIds, ['A001'])
})

test('planUpsert: 顧客番号が無い行は untracked に分離する（論点B ③の全置換対象）', () => {
  const extracted = [row(1, null), row(2, 'B002'), row(3, null)]
  const plan = planUpsert({
    listId: LIST,
    userId: USER,
    extracted,
    matches: [MATCH, MATCH, MATCH],
    existingByExternalId: new Map(),
    newId: counter(),
  })

  assert.equal(plan.tracked.length, 1)
  assert.equal(plan.tracked[0].external_id, 'B002')
  assert.equal(plan.untracked.length, 2)
  for (const r of plan.untracked) assert.equal(r.external_id, null)
})

test('planUpsert: extracted と matches の長さ不一致は例外（行ズレを黙って通さない）', () => {
  assert.throws(() =>
    planUpsert({
      listId: LIST,
      userId: USER,
      extracted: [row(1, 'A001'), row(2, 'B002')],
      matches: [MATCH],
      existingByExternalId: new Map(),
      newId: counter(),
    }),
  )
})

// ── 購入希望マッチ（BM-2 / c5）────────────────────────────────────────
// BM-2 のフィールドを差し込んだ ExtractedRow を作る（row() の薄いラッパ）。
function bmRow(
  row_no: number,
  external_id: string | null,
  patch: Partial<ExtractedRow> = {},
): ExtractedRow {
  return { ...row(row_no, external_id), ...patch }
}

const PT_HOUSE = {
  code: 'new_detached' as const,
  price_min: 3000,
  price_max: 4000,
  is_primary: true,
}
const PT_LAND = {
  code: 'land' as const,
  price_min: null,
  price_max: 2000,
  is_primary: false,
}

test('planUpsert(BM): 子行は最終的な行 id に紐づき、list_id/user_id が入る', () => {
  const extracted = [
    bmRow(1, 'A001', { property_types: [PT_HOUSE, PT_LAND] }),
    bmRow(2, null, { property_types: [PT_HOUSE] }),
  ]
  const plan = planUpsert({
    listId: LIST,
    userId: USER,
    extracted,
    matches: [MATCH, MATCH],
    existingByExternalId: new Map([['A001', 'existing-a']]),
    newId: counter(),
  })

  assert.equal(plan.propertyTypeRows.length, 3)
  assert.deepEqual(plan.propertyTypeRows[0], {
    row_id: 'existing-a', // 既存行の id を再利用している
    property_type: 'new_detached',
    price_min: 3000,
    price_max: 4000,
    is_primary: true,
    list_id: LIST,
    user_id: USER,
  })
  // untracked 行の子行も、その行に採番された id を指す。
  const untrackedId = plan.untracked[0].id
  assert.equal(plan.propertyTypeRows[2].row_id, untrackedId)
})

test('planUpsert(BM): 削除フラグ ON の行の子行は作らない（行本体を UPSERT しないため）', () => {
  const extracted = [
    bmRow(1, 'A001', { is_deleted: true, property_types: [PT_HOUSE] }),
    bmRow(2, 'B002', { property_types: [PT_LAND] }),
  ]
  const plan = planUpsert({
    listId: LIST,
    userId: USER,
    extracted,
    matches: [MATCH, MATCH],
    existingByExternalId: new Map([['A001', 'existing-a']]),
    newId: counter(),
  })
  assert.deepEqual(plan.deletedRowIds, ['existing-a'])
  assert.equal(plan.propertyTypeRows.length, 1)
  assert.equal(plan.propertyTypeRows[0].property_type, 'land')
})

test('planUpsert(BM): external_id 重複は後勝ち。子行も後勝ちの行のものだけが残る', () => {
  const extracted = [
    bmRow(1, 'A001', { property_types: [PT_HOUSE] }),
    bmRow(2, 'A001', { property_types: [PT_LAND] }),
  ]
  const plan = planUpsert({
    listId: LIST,
    userId: USER,
    extracted,
    matches: [MATCH, MATCH],
    existingByExternalId: new Map(),
    newId: counter(),
  })
  assert.equal(plan.tracked.length, 1)
  assert.deepEqual(plan.dedupedExternalIds, ['A001'])
  assert.equal(plan.propertyTypeRows.length, 1)
  assert.equal(plan.propertyTypeRows[0].property_type, 'land') // 後勝ちの行のもの
  assert.equal(plan.propertyTypeRows[0].row_id, plan.tracked[0].id)
})

test('planUpsert(BM): lead_type は常に載る（既定 unknown も明示的に書く）', () => {
  const extracted = [bmRow(1, 'A001', { lead_type: 'buy' }), bmRow(2, 'B002')]
  const plan = planUpsert({
    listId: LIST,
    userId: USER,
    extracted,
    matches: [MATCH, MATCH],
    existingByExternalId: new Map(),
    newId: counter(),
  })
  assert.equal(plan.tracked[0].lead_type, 'buy')
  assert.equal(plan.tracked[1].lead_type, 'unknown')
  for (const r of plan.tracked) assert.ok('lead_type' in r)
})

test('planUpsert(BM): 面積 4 列は persistDesiredArea のときだけ載る（既存値の保全）', () => {
  const extracted = [
    bmRow(1, 'A001', {
      desired_floor_area_min: 80,
      desired_floor_area_max: 120,
      desired_land_area_min: 150,
      desired_land_area_max: null,
    }),
  ]
  const params = {
    listId: LIST,
    userId: USER,
    extracted,
    matches: [MATCH],
    existingByExternalId: new Map<string, string>(),
    newId: counter(),
  }

  // 列を解決できなかった CSV: キーごと省略され、UPSERT の SET 句に載らない。
  const off = planUpsert(params)
  for (const k of [
    'desired_floor_area_min',
    'desired_floor_area_max',
    'desired_land_area_min',
    'desired_land_area_max',
  ]) {
    assert.equal(k in off.tracked[0], false, `${k} は載らないはず`)
  }

  // 列を解決できた CSV: 4 列とも載る（null も明示的に書いて上書きする）。
  const on = planUpsert({ ...params, newId: counter(), persistDesiredArea: true })
  assert.equal(on.tracked[0].desired_floor_area_min, 80)
  assert.equal(on.tracked[0].desired_floor_area_max, 120)
  assert.equal(on.tracked[0].desired_land_area_min, 150)
  assert.equal(on.tracked[0].desired_land_area_max, null)
  assert.equal('desired_land_area_max' in on.tracked[0], true)
})

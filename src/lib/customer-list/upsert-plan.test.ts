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

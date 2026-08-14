// compareAttackRows（アタックリストの決定的ソート）のユニットテスト。
//   並び順: status グループ(confirmed→ambiguous→out_of_scope)
//     → ランク(S>A>B>C>D・未設定は最後) → 取得スコア降順(NULLS LAST)
//     → 最終接触日降順(NULLS LAST) → id 昇順（全順序保証の決定的タイブレーク）。
//   ※ compareAttackRows は純粋関数。server.ts の @supabase 依存は型のみ(import type)で
//     実行時に読み込まれないため node --test で動く。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareAttackRows, type AttackSortRow } from './server.ts'

// 最小フィクスチャ生成（confirmed 既定）。
function row(over: Partial<AttackSortRow> & { id: string }): AttackSortRow {
  return {
    match_status: 'confirmed',
    priority_rank: 'S',
    priority_score: 10,
    last_contact_at: null,
    ...over,
  }
}

// 入力順に依存せず一意に定まることを保証するため、逆順でも同じ結果になることを確認する。
function sortIds(rows: AttackSortRow[]): string[] {
  return [...rows].sort(compareAttackRows).map((r) => r.id)
}

test('全員Sランク・スコア同値・最終接触日NULL → id 昇順で決定的', () => {
  // 上位キー(status/rank/score/last_contact)が全同値。id 昇順だけが順序を決める。
  const rows: AttackSortRow[] = [
    row({ id: 'c' }),
    row({ id: 'a' }),
    row({ id: 'b' }),
  ]
  assert.deepEqual(sortIds(rows), ['a', 'b', 'c'])
  // 入力順を変えても結果が同一（決定的・全順序）であることを固定する。
  assert.deepEqual(sortIds([...rows].reverse()), ['a', 'b', 'c'])
})

test('取得スコアは降順・NULL は最後', () => {
  const rows: AttackSortRow[] = [
    row({ id: 'low', priority_score: 1 }),
    row({ id: 'nullscore', priority_score: null }),
    row({ id: 'high', priority_score: 9 }),
  ]
  assert.deepEqual(sortIds(rows), ['high', 'low', 'nullscore'])
})

test('最終接触日は降順（新しい順）・NULL は最後', () => {
  // rank/score を同値にして最終接触日だけで比較させる。
  const rows: AttackSortRow[] = [
    row({ id: 'old', last_contact_at: '2026-01-01' }),
    row({ id: 'nullc', last_contact_at: null }),
    row({ id: 'new', last_contact_at: '2026-08-01' }),
  ]
  assert.deepEqual(sortIds(rows), ['new', 'old', 'nullc'])
})

test('ランクが最優先（S>A>B>C>D・未設定は最後）', () => {
  const rows: AttackSortRow[] = [
    row({ id: 'b', priority_rank: 'B' }),
    row({ id: 's', priority_rank: 'S' }),
    row({ id: 'none', priority_rank: null }),
    row({ id: 'a', priority_rank: 'A' }),
  ]
  assert.deepEqual(sortIds(rows), ['s', 'a', 'b', 'none'])
})

test('status グループが最上位（confirmed→ambiguous→out_of_scope）', () => {
  // 非 confirmed は高スコアでも confirmed の後段（確定と推定を混ぜない・原則1）。
  const rows: AttackSortRow[] = [
    row({ id: 'oos', match_status: 'out_of_scope', priority_rank: null, priority_score: null }),
    row({ id: 'amb', match_status: 'ambiguous', priority_rank: null, priority_score: null }),
    row({ id: 'conf', match_status: 'confirmed', priority_rank: 'D', priority_score: 0 }),
  ]
  assert.deepEqual(sortIds(rows), ['conf', 'amb', 'oos'])
})

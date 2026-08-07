// server.ts の「エラー握りつぶし禁止」方針のユニットテスト。
//   旧実装の `if (error) break` は timeout(57014) を握りつぶし、空インデックスで続行→
//   全行 out_of_scope・municipality_id=NULL のゴミデータを保存していた（実測）。
//   本テストは fetchLatestRows が DB エラー時に throw することを保証する。
//   ※ Supabase クライアントはスタブ（DB 非依存）。server.ts の @supabase 依存は
//     型のみ(import type)で実行時に読み込まれないため node --test で動く。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchLatestRows } from './server.ts'

// PostgREST クエリビルダの最小スタブ:
//   from().select().in().range() の順に呼ばれ、最後に await される（thenable）。
function makeClient(result) {
  const thenable = { then: (resolve) => resolve(result) }
  return {
    from: () => ({
      select: () => ({
        in: () => ({
          range: () => thenable,
        }),
      }),
    }),
  }
}

const IDS = ['11111111-1111-1111-1111-111111111111']

test('fetchLatestRows: DBエラー(57014)は握りつぶさず throw する', async () => {
  const client = makeClient({
    data: null,
    error: { code: '57014', message: 'canceling statement due to statement timeout' },
  })
  await assert.rejects(
    () => fetchLatestRows(client, IDS),
    /57014|statement timeout/,
  )
})

test('fetchLatestRows: 空 id は DB アクセスせず [] を返す', async () => {
  let touched = false
  const client = {
    from: () => {
      touched = true
      return {}
    },
  }
  const res = await fetchLatestRows(client, [])
  assert.deepEqual(res, [])
  assert.equal(touched, false)
})

test('fetchLatestRows: 正常時は行を返す', async () => {
  const row = {
    municipality_id: IDS[0],
    municipality_name: '岡崎市',
    town_id: 1,
    town_name: '稲熊町',
    town_name_raw: '稲熊町',
    office_name: null,
    as_of: '2026-06-01',
    inferred_priority_rank: 'A',
    inferred_reason: 'test',
  }
  const client = makeClient({ data: [row], error: null })
  const res = await fetchLatestRows(client, IDS)
  assert.equal(res.length, 1)
  assert.equal(res[0].town_name, '稲熊町')
})

// 削除フラグ/オプトアウトの取込（O54/O55・PR-D改 c3）と、正規化→突合入力パイプ（DB 不要部分）の
//   ユニットテスト。依存ゼロ。
//   ⛔ 顧客の生データは使わない。架空フィクスチャ（docs/specs 配下）のヘッダのみを使い、
//      データ行はテスト内で合成する（実在の個人情報を書かない）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseCsv, detectColumnMapping } from './csv-import.ts'
import { resolveColumnMapping } from './presets.ts'
import { extractRows } from './row-extract.ts'
import { planUpsert } from './upsert-plan.ts'
import { normalizeJpAddress } from '../address/normalize-jp.ts'
import type { ExtractedRow } from './row-extract.ts'
import type { MatchResult } from './types.ts'

const FIXTURE_PATH = new URL(
  '../../../docs/specs/hausudo_customer_headers_fixture_v1.csv',
  import.meta.url,
)

function loadHeader(): string[] {
  return parseCsv(readFileSync(FIXTURE_PATH, 'utf8'))[0]
}

// フラグ列の 0 始まり index（CSV は 1 始まり: 72/89/90/123）。
const IDX_DM = 71 // 72列 DM郵送希望
const IDX_MAILMAG = 88 // 89列 メルマガフラグ（メール営業対象者フラグ）
const IDX_MAIL = 89 // 90列 メール禁止フラグ
const IDX_DELETED = 122 // 123列 削除フラグ
// 住所複合列（41/42/43）と顧客番号（1）。
const IDX_PREF = 40
const IDX_CITY = 41
const IDX_ADDR = 42
const IDX_EXTID = 0

// ── プリセットがフラグ列を「ヘッダ名の完全一致」で解決すること（列位置決め打ちではない）──
test('resolveColumnMapping(hausudo): 72/89/90/123 列がヘッダ名で解決される（O58）', () => {
  const header = loadHeader()
  const { extract } = resolveColumnMapping(header, 'hausudo')
  assert.equal(extract.optOutDmColumn, IDX_DM)
  assert.equal(extract.optOutMailMagazineColumn, IDX_MAILMAG) // 全角括弧 NFKC 吸収の回帰
  assert.equal(extract.optOutMailColumn, IDX_MAIL)
  assert.equal(extract.deletedColumn, IDX_DELETED)
})

// ── 抽出: 空=OFF / 非空=ON（空白のみは trim して OFF）──
test('extractRows: オプトアウト/削除フラグは 空=OFF・非空=ON（空白のみは OFF）', () => {
  const header = loadHeader()
  const { mapping, extract } = resolveColumnMapping(header, 'hausudo')

  const blank = () => header.map(() => '')
  // 行1: すべて ON（'1'）。行2: すべて OFF（空）。行3: 空白のみ→OFF。行4: 非空の別値→ON。
  const r1 = blank()
  r1[IDX_EXTID] = 'C001'
  r1[IDX_DM] = '1'
  r1[IDX_MAILMAG] = '1'
  r1[IDX_MAIL] = '1'
  r1[IDX_DELETED] = '1'
  const r2 = blank()
  r2[IDX_EXTID] = 'C002'
  const r3 = blank()
  r3[IDX_EXTID] = 'C003'
  r3[IDX_DM] = '   ' // 空白のみ
  r3[IDX_DELETED] = '\t'
  const r4 = blank()
  r4[IDX_EXTID] = 'C004'
  r4[IDX_MAIL] = 'X' // '1' 以外の非空も ON

  const out = extractRows([r1, r2, r3, r4], mapping, extract)

  assert.deepEqual(
    [out[0].opt_out_dm, out[0].opt_out_mail_magazine, out[0].opt_out_mail, out[0].is_deleted],
    [true, true, true, true],
  )
  assert.deepEqual(
    [out[1].opt_out_dm, out[1].opt_out_mail_magazine, out[1].opt_out_mail, out[1].is_deleted],
    [false, false, false, false],
  )
  assert.equal(out[2].opt_out_dm, false) // 空白のみ→OFF
  assert.equal(out[2].is_deleted, false)
  assert.equal(out[3].opt_out_mail, true) // 非空なら '1' 以外でも ON
})

// ── プリセット未選択（heuristic）経路では列位置決め打ちをしない＝全行 OFF ──
test('extractRows: heuristic 経路（フラグ列を解決しない）は全フラグ OFF（列決め打ちしない）', () => {
  const csv = '顧客番号,住所,DM郵送希望\nD001,岡崎市明大寺町1-2-3,1\n'
  const rows = parseCsv(csv)
  // detectColumnMapping はフラグ列を解決しない（ExtractOptions を渡さない＝列未指定）。
  const out = extractRows(rows.slice(1), detectColumnMapping(rows[0]))
  assert.equal(out[0].opt_out_dm, false)
  assert.equal(out[0].opt_out_mail_magazine, false)
  assert.equal(out[0].opt_out_mail, false)
  assert.equal(out[0].is_deleted, false)
})

// ── 正規化→突合入力パイプ（DB 不要部分）: 複合住所結合 → normalizeJpAddress 分解 ──
test('パイプ（DB不要）: 複合住所を結合し normalizeJpAddress が (muni5, town, chome, ban, go) に分解する', () => {
  const header = loadHeader()
  const { mapping, extract } = resolveColumnMapping(header, 'hausudo')
  const blank = () => header.map(() => '')
  const r = blank()
  r[IDX_EXTID] = 'E001'
  r[IDX_PREF] = '愛知県'
  r[IDX_CITY] = '岡崎市'
  r[IDX_ADDR] = '明大寺町1丁目2番3号'

  const out = extractRows([r], mapping, extract)
  assert.equal(out[0].address_raw, '愛知県岡崎市明大寺町1丁目2番3号') // 複合列の生結合

  const norm = normalizeJpAddress(out[0].address_raw ?? '')
  assert.equal(norm.status, 'normalized')
  assert.equal(norm.muniCode5, '23202') // 岡崎市
  assert.equal(norm.town, '明大寺町')
  assert.equal(norm.chome, '1')
  assert.equal(norm.ban, '2')
  assert.equal(norm.go, '3')
})

// ============================================================
// planUpsert の削除フラグ分岐（裁定A）
// ============================================================
const LIST = '11111111-1111-1111-1111-111111111111'
const USER = '22222222-2222-2222-2222-222222222222'

function counter() {
  let n = 0
  return () => `new-${++n}`
}

function erow(
  row_no: number,
  external_id: string | null,
  opts: Partial<
    Pick<ExtractedRow, 'opt_out_dm' | 'opt_out_mail_magazine' | 'opt_out_mail' | 'is_deleted'>
  > = {},
): ExtractedRow {
  return {
    row_no,
    external_id,
    customer_name: `顧客${row_no}`,
    address_raw: '岡崎市明大寺町1-2-3',
    inquiry_at: null,
    last_contact_at: null,
    media: null,
    category: null,
    assignee: null,
    desired_school: null,
    desired_muni_code_5: null,
    opt_out_dm: opts.opt_out_dm ?? false,
    opt_out_mail_magazine: opts.opt_out_mail_magazine ?? false,
    opt_out_mail: opts.opt_out_mail ?? false,
    is_deleted: opts.is_deleted ?? false,
    reasons: [],
  }
}

const MATCH: MatchResult = {
  status: 'out_of_scope',
  municipality_id: null,
  town_name_normalized: null,
  candidates: [],
  address_normalized: '岡崎市明大寺町1-2-3',
}

test('planUpsert: 削除ON かつ external_id が DB 既存 → deletedRowIds に入り tracked から外れる（裁定A a）', () => {
  const extracted = [erow(1, 'A001', { is_deleted: true }), erow(2, 'B002')]
  const plan = planUpsert({
    listId: LIST,
    userId: USER,
    extracted,
    matches: [MATCH, MATCH],
    existingByExternalId: new Map([['A001', 'existing-a']]),
    newId: counter(),
  })
  assert.deepEqual(plan.deletedRowIds, ['existing-a'])
  assert.equal(plan.tracked.length, 1) // B002 のみ
  assert.equal(plan.tracked[0].external_id, 'B002')
  assert.ok(!plan.tracked.some((r) => r.external_id === 'A001'))
})

test('planUpsert: 削除ON かつ DB 未存在 → 行を作らない（tracked も deletedRowIds も空・裁定A b）', () => {
  const extracted = [erow(1, 'Z999', { is_deleted: true })]
  const plan = planUpsert({
    listId: LIST,
    userId: USER,
    extracted,
    matches: [MATCH],
    existingByExternalId: new Map(),
    newId: counter(),
  })
  assert.equal(plan.tracked.length, 0)
  assert.equal(plan.untracked.length, 0)
  assert.deepEqual(plan.deletedRowIds, [])
})

test('planUpsert: 削除ON かつ external_id 無し → 行を作らない（追跡不能はスキップ・裁定A b）', () => {
  const extracted = [erow(1, null, { is_deleted: true }), erow(2, null)]
  const plan = planUpsert({
    listId: LIST,
    userId: USER,
    extracted,
    matches: [MATCH, MATCH],
    existingByExternalId: new Map(),
    newId: counter(),
  })
  // 削除ON の無 external_id はスキップ。削除OFF の無 external_id は untracked に残る。
  assert.equal(plan.untracked.length, 1)
  assert.equal(plan.untracked[0].row_no, 2)
  assert.deepEqual(plan.deletedRowIds, [])
})

test('planUpsert: 削除OFF 行は opt_out を保存し deleted_at を NULL に戻す（CRM を正・裁定A）', () => {
  const extracted = [erow(1, 'B002', { opt_out_dm: true, opt_out_mail: true })]
  const plan = planUpsert({
    listId: LIST,
    userId: USER,
    extracted,
    matches: [MATCH],
    existingByExternalId: new Map([['B002', 'existing-b']]),
    newId: counter(),
  })
  assert.equal(plan.tracked.length, 1)
  const r = plan.tracked[0]
  assert.equal(r.opt_out_dm, true)
  assert.equal(r.opt_out_mail_magazine, false)
  assert.equal(r.opt_out_mail, true)
  assert.equal(r.deleted_at, null) // 再出現で deleted_at を必ず解除する
  assert.deepEqual(plan.deletedRowIds, [])
})

test('planUpsert: 同一 external_id が複数回 削除ON でも deletedRowIds は重複しない', () => {
  const extracted = [
    erow(1, 'A001', { is_deleted: true }),
    erow(2, 'A001', { is_deleted: true }),
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
})

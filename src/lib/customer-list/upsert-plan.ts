// ============================================================
// 毎回全件 UPSERT（CL-17）の計画づくり — 純ロジック（DB 非依存・テスト対象）。
//
// ⚠ なぜ「主キー UPSERT」なのか（PR-A 申し送りとの差分・論点A①）:
//    PR-A が張った UNIQUE は **部分索引** (list_id, external_id) WHERE external_id IS NOT NULL。
//    PostgreSQL は部分索引に対し推論条件付き `ON CONFLICT (...) WHERE ...` を要求するが、
//    PostgREST の on_conflict は列名リストしか送れない（postgrest-js: URL の
//    on_conflict パラメータに列名を set するのみ）。よって推論できず 42P10 になる。
//    → 代わりに「既存 external_id → 行 id を先に読み戻し、行 id（主キー）を明示して
//      upsert する」方式を採る。既存 id を渡した行は UPDATE、新規 uuid の行は INSERT。
//    ⚠ 読み戻しと UPSERT の間に他セッションが同じ external_id を作ると競合し得るが、
//      部分 UNIQUE は DB 側に残っているため **最悪でも 23505 で止まるだけでデータは壊れない**
//      （重複行が生まれることはない）。厳密な原子性が要るようになったら、
//      PR#4 のバッチ RPC 作業と合わせて SQL 関数側へ移す。
// ============================================================

import type { MatchResult, MatchCandidate, MatchStatus } from './types.ts'
import type { ExtractedRow } from './row-extract.ts'

// customer_list_rows へ送る 1 行分のペイロード。
//   ⛔ desired_school / desired_muni_code_5 は含めない（PR-C で充填する列を
//      PR-B が毎回 null で上書きしないため）。organization_id も含めない
//      （INSERT は trg_set_customer_list_row_org が親から埋め、UPDATE では不変）。
export interface UpsertRow {
  id: string
  list_id: string
  user_id: string
  row_no: number
  external_id: string | null
  customer_name: string | null
  address_raw: string | null
  address_normalized: string | null
  municipality_id: string | null
  town_name_normalized: string | null
  match_status: MatchStatus
  match_candidates: MatchCandidate[] | null
  inquiry_at: string | null
  last_contact_at: string | null
  media: string | null
  category: string | null
  assignee: string | null
  // 再出現した行は必ず missing_since を消す（PR-A 申し送り②）。
  missing_since: null
}

export interface UpsertPlan {
  // external_id を持つ行（主キー UPSERT の対象）。
  tracked: UpsertRow[]
  // external_id を持たない行（論点B ③: 当該 list の NULL 行を全置換する対象）。
  untracked: UpsertRow[]
  // CSV 内で external_id が重複し、後勝ちで畳んだ external_id 一覧（サマリ用）。
  dedupedExternalIds: string[]
}

export interface PlanUpsertParams {
  listId: string
  userId: string
  extracted: ExtractedRow[]
  // extracted と同じ長さ・同じ順序の突合結果。
  matches: MatchResult[]
  // 既存行の external_id → 行 id（loadExistingExternalIds の戻り値）。
  existingByExternalId: Map<string, string>
  // 新規行の主キー採番。テストから決定的な値を注入できるよう引数にする。
  newId: () => string
}

// ExtractedRow + MatchResult → UpsertRow。
function buildRow(
  listId: string,
  userId: string,
  id: string,
  e: ExtractedRow,
  m: MatchResult,
): UpsertRow {
  return {
    id,
    list_id: listId,
    user_id: userId,
    row_no: e.row_no,
    external_id: e.external_id,
    customer_name: e.customer_name,
    address_raw: e.address_raw,
    // 正規化住所は突合エンジンの出力（ExtractedRow ではなく MatchResult が持つ）。
    address_normalized: m.address_normalized || null,
    municipality_id: m.municipality_id,
    town_name_normalized: m.town_name_normalized,
    match_status: m.status,
    match_candidates: m.candidates.length > 0 ? m.candidates : null,
    inquiry_at: e.inquiry_at,
    last_contact_at: e.last_contact_at,
    media: e.media,
    category: e.category,
    assignee: e.assignee,
    missing_since: null,
  }
}

// UPSERT 計画を組み立てる。
//   - external_id 有り  → 既存 id を引き当て（無ければ採番）。CSV 内重複は **後勝ち**。
//   - external_id 無し  → untracked。追跡できないため missing_since は付けられない。
export function planUpsert(params: PlanUpsertParams): UpsertPlan {
  const { listId, userId, extracted, matches, existingByExternalId, newId } = params
  if (extracted.length !== matches.length) {
    throw new Error('planUpsert: extracted と matches の長さが一致しません')
  }

  // Map は挿入順を保つ。同一 external_id の再出現では値だけを差し替える（後勝ち）。
  const trackedByExternalId = new Map<string, UpsertRow>()
  const dedupedExternalIds: string[] = []
  const untracked: UpsertRow[] = []

  extracted.forEach((e, i) => {
    const m = matches[i]
    if (e.external_id == null) {
      untracked.push(buildRow(listId, userId, newId(), e, m))
      return
    }
    const existing = trackedByExternalId.get(e.external_id)
    // 既存行の id は「DB にある id」＞「同一 CSV 内で既に採番した id」の順で再利用する。
    const id =
      existing?.id ?? existingByExternalId.get(e.external_id) ?? newId()
    if (existing) dedupedExternalIds.push(e.external_id)
    trackedByExternalId.set(e.external_id, buildRow(listId, userId, id, e, m))
  })

  return {
    tracked: Array.from(trackedByExternalId.values()),
    untracked,
    dedupedExternalIds,
  }
}

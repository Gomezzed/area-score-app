// ============================================================
// 顧客リスト連携（D24）— サーバー専用ヘルパー（Route Handler から利用）。
//   - サーバー側フィーチャーフラグの判定（二層封鎖の裏側）
//   - customer_list_town_latest ビュー（自治体ごとの最新 as_of）から
//     突合用インデックス / ランク表 / 突合基準の as_of を構築
//   いずれもユーザースコープの Supabase クライアント（RLS 準拠）で読む。
//   ビューは security_invoker で基表 RLS を継承し platinum のみ SELECT 可。
//   呼び出し前に guardFeature('townAcquisitionPriority') で platinum を担保する。
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildTownIndex } from './match.ts'
import { normalizeTownName } from './normalize.ts'
import { latestPerMunicipality } from './latest.ts'
import type { TownIndex } from './match.ts'
import type { TownRecord } from './types.ts'

// サーバー側フィーチャーフラグ（H9 の教訓: UI と二層で封鎖する）。
//   off のとき Route Handler は 404 を返す（機能の存在自体を隠す）。
export function isCustomerListEnabled(): boolean {
  return process.env.FEATURE_CUSTOMER_LIST === 'true'
}

// PostgREST の1リクエスト上限（既定 1000 行）を跨いでページ取得する。
const PAGE = 1000
const MAX_PAGES = 20 // 安全弁（最大 2万行）。最新月のみのビューは十分収まる。

// 突合基準の as_of（自治体別）。UI フッターの「町域データ: ◯◯市 YYYY年M月時点」に使う。
export interface MuniAsOf {
  municipality_id: string
  municipality_name: string
  as_of: string
}

// ビュー1行（customer_list_town_latest と対応）。
interface LatestRow {
  municipality_id: string
  municipality_name: string
  town_id: number
  town_name: string
  town_name_raw: string | null
  office_name: string | null
  as_of: string
  inferred_priority_rank: string | null
  inferred_reason: string | null
}

const SELECT_COLS =
  'municipality_id, municipality_name, town_id, town_name, town_name_raw, office_name, as_of, inferred_priority_rank, inferred_reason'

// customer_list_town_latest から行を取得（任意で municipality_id で絞り込み）。
//   ビューが既に自治体別最新月に絞っているが、アプリ層でも latestPerMunicipality を
//   通して「最新月選定」を DB 非依存に保証する（グローバル最大月方式への退行検知）。
async function fetchLatestRows(
  supabase: SupabaseClient,
  municipalityIds?: string[],
): Promise<LatestRow[]> {
  const ids = municipalityIds
    ? Array.from(new Set(municipalityIds)).filter(Boolean)
    : undefined
  if (ids && ids.length === 0) return []

  const rows: LatestRow[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE
    let q = supabase
      .from('customer_list_town_latest')
      .select(SELECT_COLS)
      .range(from, from + PAGE - 1)
    if (ids) q = q.in('municipality_id', ids)
    const { data, error } = await q
    if (error || !data || data.length === 0) break
    rows.push(...(data as unknown as LatestRow[]))
    if (data.length < PAGE) break
  }
  return latestPerMunicipality(
    rows,
    (r) => r.municipality_id,
    (r) => r.as_of,
  )
}

// 突合インデックス＋突合基準 as_of（全スコープ自治体）を構築する。
export async function loadTownIndex(
  supabase: SupabaseClient,
): Promise<{ index: TownIndex; muniAsOf: MuniAsOf[] }> {
  const rows = await fetchLatestRows(supabase)
  const records: TownRecord[] = rows.map((r) => ({
    municipality_id: r.municipality_id,
    municipality_name: r.municipality_name,
    town_id: r.town_id,
    town_name: r.town_name,
    town_name_raw: r.town_name_raw,
    office_name: r.office_name,
  }))
  return { index: buildTownIndex(records), muniAsOf: collectMuniAsOf(rows) }
}

export interface RankInfo {
  rank: string | null
  reason: string | null
}

// 指定自治体の (municipality_id, 正規化町名) → ランク/根拠 の表と、突合基準 as_of を返す。
//   アタックリスト表示時に confirmed 行へ join する（ランクは保存しない設計）。
export async function loadRankData(
  supabase: SupabaseClient,
  municipalityIds: string[],
): Promise<{ rankMap: Map<string, RankInfo>; muniAsOf: MuniAsOf[] }> {
  const rankMap = new Map<string, RankInfo>()
  const rows = await fetchLatestRows(supabase, municipalityIds)
  for (const r of rows) {
    const key = rankKey(r.municipality_id, normalizeTownName(r.town_name))
    const next: RankInfo = {
      rank: r.inferred_priority_rank,
      reason: r.inferred_reason,
    }
    // 同一町名が複数 town_id で存在する場合は最優先ランクを採る（S>A>B>C>D）。
    const existing = rankMap.get(key)
    if (!existing || rankOrder(next.rank) < rankOrder(existing.rank)) {
      rankMap.set(key, next)
    }
  }
  return { rankMap, muniAsOf: collectMuniAsOf(rows) }
}

// (municipality_id, 正規化町名) の join キー。
export function rankKey(municipalityId: string, normTownName: string): string {
  return `${municipalityId}|${normTownName}`
}

// ランク文字列 → ソート順（小さいほど高優先。S>A>B>C>D、未設定は最後）。
export function rankOrder(rank: string | null | undefined): number {
  switch (rank) {
    case 'S':
      return 0
    case 'A':
      return 1
    case 'B':
      return 2
    case 'C':
      return 3
    case 'D':
      return 4
    default:
      return 9
  }
}

// 行集合から自治体別 as_of（＝突合基準月）を抽出する。
function collectMuniAsOf(rows: LatestRow[]): MuniAsOf[] {
  const map = new Map<string, MuniAsOf>()
  for (const r of rows) {
    if (!map.has(r.municipality_id)) {
      map.set(r.municipality_id, {
        municipality_id: r.municipality_id,
        municipality_name: r.municipality_name,
        as_of: r.as_of,
      })
    }
  }
  return Array.from(map.values())
}

// ============================================================
// 顧客リスト連携（D24）— サーバー専用ヘルパー（Route Handler から利用）。
//   - サーバー側フィーチャーフラグの判定（二層封鎖の裏側）
//   - town_monthly_metrics から突合用インデックス / ランク表を構築
//   いずれもユーザースコープの Supabase クライアント（RLS 準拠）で読む。
//   town_monthly_metrics は platinum のみ SELECT 可（RLS）。呼び出し前に
//   guardFeature('townAcquisitionPriority') で platinum を担保しているため、
//   ここでは 0 行フォールバック（＝該当住所は out_of_scope）として安全に振る舞う。
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildTownIndex } from './match.ts'
import { normalizeTownName } from './normalize.ts'
import type { TownIndex } from './match.ts'
import type { TownRecord } from './types.ts'

// サーバー側フィーチャーフラグ（H9 の教訓: UI と二層で封鎖する）。
//   off のとき Route Handler は 404 を返す（機能の存在自体を隠す）。
export function isCustomerListEnabled(): boolean {
  return process.env.FEATURE_CUSTOMER_LIST === 'true'
}

// PostgREST の1リクエスト上限（既定 1000 行）を跨いでページ取得する。
const PAGE = 1000
const MAX_PAGES = 20 // 安全弁（最大 2万行）。町域マスタは十分収まる。

// 突合用の町域インデックスを構築する。
//   町域の同一性（municipality_id, town_id, town_name, office_name）は月次で不変のため、
//   最新 as_of 1ヶ月分だけを取得すれば全町域を一意に得られる（月データの全走査は不要）。
export async function loadTownIndex(
  supabase: SupabaseClient,
): Promise<TownIndex> {
  // 最新 as_of（全体の最大月）を1件で取得。
  const { data: latest } = await supabase
    .from('town_monthly_metrics')
    .select('as_of')
    .order('as_of', { ascending: false })
    .limit(1)
    .maybeSingle()

  const asOf = latest?.as_of as string | undefined
  if (!asOf) return buildTownIndex([])

  const records: TownRecord[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE
    const { data, error } = await supabase
      .from('town_monthly_metrics')
      .select(
        'municipality_id, town_id, town_name, town_name_raw, office_name, municipalities(name)',
      )
      .eq('as_of', asOf)
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    for (const r of data as unknown as TownRow[]) {
      const municipality_name = extractMuniName(r.municipalities)
      if (!municipality_name) continue
      records.push({
        municipality_id: r.municipality_id,
        municipality_name,
        town_id: r.town_id,
        town_name: r.town_name,
        town_name_raw: r.town_name_raw,
        office_name: r.office_name,
      })
    }
    if (data.length < PAGE) break
  }

  return buildTownIndex(records)
}

// 最新 as_of の (municipality_id, 正規化町名) → 取得優先ランク/根拠 の表を作る。
//   アタックリスト表示時に confirmed 行へ join する（ランクは保存しない設計）。
export interface RankInfo {
  rank: string | null
  reason: string | null
}

export async function loadRankMap(
  supabase: SupabaseClient,
  municipalityIds: string[],
): Promise<Map<string, RankInfo>> {
  const map = new Map<string, RankInfo>()
  const ids = Array.from(new Set(municipalityIds)).filter(Boolean)
  if (ids.length === 0) return map

  const { data: latest } = await supabase
    .from('town_monthly_metrics')
    .select('as_of')
    .order('as_of', { ascending: false })
    .limit(1)
    .maybeSingle()
  const asOf = latest?.as_of as string | undefined
  if (!asOf) return map

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE
    const { data, error } = await supabase
      .from('town_monthly_metrics')
      .select('municipality_id, town_name, inferred_priority_rank, inferred_reason')
      .eq('as_of', asOf)
      .in('municipality_id', ids)
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    for (const r of data as unknown as RankRow[]) {
      const key = rankKey(r.municipality_id, normalizeTownName(r.town_name))
      // 同一町名が複数 town_id で存在する場合は最優先ランクを採る（S>A>B>C>D）。
      const existing = map.get(key)
      const next: RankInfo = {
        rank: r.inferred_priority_rank,
        reason: r.inferred_reason,
      }
      if (!existing || rankOrder(next.rank) < rankOrder(existing.rank)) {
        map.set(key, next)
      }
    }
    if (data.length < PAGE) break
  }
  return map
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

// ── 内部型 ──────────────────────────────────────────────────────────
interface TownRow {
  municipality_id: string
  town_id: number
  town_name: string
  town_name_raw: string | null
  office_name: string | null
  // PostgREST の埋め込みは対象により object / array のどちらでも返りうる。
  municipalities: { name: string } | { name: string }[] | null
}

interface RankRow {
  municipality_id: string
  town_name: string
  inferred_priority_rank: string | null
  inferred_reason: string | null
}

function extractMuniName(
  m: { name: string } | { name: string }[] | null,
): string | null {
  if (!m) return null
  if (Array.isArray(m)) return m[0]?.name ?? null
  return m.name ?? null
}

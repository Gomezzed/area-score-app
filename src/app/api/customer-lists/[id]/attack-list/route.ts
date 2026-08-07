import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { guardFeature } from '@/lib/subscription'
import {
  isCustomerListEnabled,
  loadRankMap,
  rankKey,
  rankOrder,
} from '@/lib/customer-list/server'
import { normalizeTownName } from '@/lib/customer-list/normalize'
import type { MatchStatus } from '@/lib/customer-list/types'

export const runtime = 'nodejs'

// アタックリスト1行（画面表示用）。
interface AttackRow {
  id: string
  row_no: number
  customer_name: string | null
  address_raw: string | null
  match_status: MatchStatus
  municipality_id: string | null
  town_name_normalized: string | null
  last_contact_at: string | null
  inquiry_at: string | null
  media: string | null
  assignee: string | null
  // confirmed 時のみ最新 as_of から join した取得優先ランク/根拠。
  priority_rank: string | null
  priority_reason: string | null
  // ambiguous 時の候補（要確認表示用）。
  match_candidates: unknown
}

// GET /api/customer-lists/[id]/attack-list
//   confirmed 行に最新 as_of の inferred_priority_rank を join し、
//   ランク(S>A>B>C>D) → 同ランク内は最終接触が古い順 でソートして返す。
//   ambiguous / out_of_scope も status 付きで返し、分離表示は UI 側で行う。
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isCustomerListEnabled()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const denied = await guardFeature('townAcquisitionPriority')
  if (denied) return denied

  const { id: listId } = await params
  const supabase = await createSupabaseServerClient()

  // 名簿の存在＆所有確認（RLS: 自分の行のみ SELECT 可）。
  const { data: list } = await supabase
    .from('customer_lists')
    .select('id, name, row_count')
    .eq('id', listId)
    .maybeSingle()
  if (!list) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // 名簿の全行を取得（RLS で自分の行のみ）。
  const { data: rows, error } = await supabase
    .from('customer_list_rows')
    .select(
      'id, row_no, customer_name, address_raw, match_status, municipality_id, town_name_normalized, last_contact_at, inquiry_at, media, assignee, match_candidates',
    )
    .eq('list_id', listId)
  if (error) {
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 })
  }
  const rowList = rows ?? []

  // confirmed 行の自治体について最新 as_of のランク表を引く。
  const muniIds = rowList
    .filter((r) => r.match_status === 'confirmed' && r.municipality_id)
    .map((r) => r.municipality_id as string)
  const rankMap = await loadRankMap(supabase, muniIds)

  const attack: AttackRow[] = rowList.map((r) => {
    let rank: string | null = null
    let reason: string | null = null
    if (r.match_status === 'confirmed' && r.municipality_id && r.town_name_normalized) {
      const info = rankMap.get(
        rankKey(r.municipality_id, normalizeTownName(r.town_name_normalized)),
      )
      rank = info?.rank ?? null
      reason = info?.reason ?? null
    }
    return {
      id: r.id,
      row_no: r.row_no,
      customer_name: r.customer_name,
      address_raw: r.address_raw,
      match_status: r.match_status as MatchStatus,
      municipality_id: r.municipality_id,
      town_name_normalized: r.town_name_normalized,
      last_contact_at: r.last_contact_at,
      inquiry_at: r.inquiry_at,
      media: r.media,
      assignee: r.assignee,
      priority_rank: rank,
      priority_reason: reason,
      match_candidates: r.match_candidates,
    }
  })

  // ソート: status グループ(confirmed→ambiguous→out_of_scope)
  //   → ランク(S>A>B>C>D・未設定は最後) → 最終接触が古い順(null は最後)。
  attack.sort((a, b) => {
    const g = statusGroup(a.match_status) - statusGroup(b.match_status)
    if (g !== 0) return g
    const ro = rankOrder(a.priority_rank) - rankOrder(b.priority_rank)
    if (ro !== 0) return ro
    return compareLastContactAsc(a.last_contact_at, b.last_contact_at)
  })

  return NextResponse.json({
    id: list.id,
    name: list.name,
    row_count: list.row_count,
    summary: summarize(attack),
    rows: attack,
  })
}

// status の表示グループ順（confirmed を先頭に）。
function statusGroup(s: MatchStatus): number {
  if (s === 'confirmed') return 0
  if (s === 'ambiguous') return 1
  return 2 // out_of_scope
}

// 最終接触が古い順（昇順）。null は最後。
function compareLastContactAsc(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a < b ? -1 : a > b ? 1 : 0
}

function summarize(rows: AttackRow[]) {
  let confirmed = 0
  let ambiguous = 0
  let outOfScope = 0
  for (const r of rows) {
    if (r.match_status === 'confirmed') confirmed++
    else if (r.match_status === 'ambiguous') ambiguous++
    else outOfScope++
  }
  return { confirmed, ambiguous, out_of_scope: outOfScope }
}

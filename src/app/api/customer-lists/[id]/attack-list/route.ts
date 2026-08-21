import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { guardFeature } from '@/lib/subscription'
import {
  isCustomerListEnabled,
  loadRankData,
  rankKey,
  compareAttackRows,
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
  // confirmed 時のみ最新 as_of から join した取得優先ランク/スコア/根拠。
  priority_rank: string | null
  priority_score: number | null
  priority_reason: string | null
  // ambiguous 時の候補（要確認表示用）。
  match_candidates: unknown
}

// GET /api/customer-lists/[id]/attack-list
//   confirmed 行に最新 as_of の inferred_priority_rank / inferred_acquisition_score を join し、
//   ランク(S>A>B>C>D) → 取得スコア降順(NULLS LAST) → 最終接触日降順(NULLS LAST) → id昇順
//   でソートして返す（compareAttackRows・決定的）。
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
  //   ⛔ アタックリストから除外する 2 条件のみを適用する（O54/O55・PR-D改 c3）:
  //     ① deleted_at IS NOT NULL（CRM で削除された顧客・裁定A）
  //     ② オプトアウト 3 列のいずれかが ON（opt_out_dm / _mail_magazine / _mail・O55）
  //   ⚠ missing_since の表示是正は本セッションのスコープ外（残件）。ここでは触らない。
  const { data: rows, error } = await supabase
    .from('customer_list_rows')
    .select(
      'id, row_no, customer_name, address_raw, match_status, municipality_id, town_name_normalized, last_contact_at, inquiry_at, media, assignee, match_candidates',
    )
    .eq('list_id', listId)
    .is('deleted_at', null)
    .eq('opt_out_dm', false)
    .eq('opt_out_mail_magazine', false)
    .eq('opt_out_mail', false)
  if (error) {
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 })
  }
  const rowList = rows ?? []

  // confirmed 行の自治体について「自治体ごとの最新 as_of」のランク表と突合基準月を引く。
  //   loadRankData は DB エラーを throw する（握りつぶし禁止・import と同一方針）。
  const muniIds = rowList
    .filter((r) => r.match_status === 'confirmed' && r.municipality_id)
    .map((r) => r.municipality_id as string)
  let rankMap: Awaited<ReturnType<typeof loadRankData>>['rankMap']
  let muniAsOf: Awaited<ReturnType<typeof loadRankData>>['muniAsOf']
  try {
    const rankData = await loadRankData(supabase, muniIds)
    rankMap = rankData.rankMap
    muniAsOf = rankData.muniAsOf
  } catch {
    return NextResponse.json({ error: 'rank_data_unavailable' }, { status: 500 })
  }

  const attack: AttackRow[] = rowList.map((r) => {
    let rank: string | null = null
    let score: number | null = null
    let reason: string | null = null
    if (r.match_status === 'confirmed' && r.municipality_id && r.town_name_normalized) {
      const info = rankMap.get(
        rankKey(r.municipality_id, normalizeTownName(r.town_name_normalized)),
      )
      rank = info?.rank ?? null
      score = info?.score ?? null
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
      priority_score: score,
      priority_reason: reason,
      match_candidates: r.match_candidates,
    }
  })

  // ソート: ランク → 取得スコア降順 → 最終接触日降順 → id昇順（compareAttackRows・決定的）。
  //   status グループ(confirmed→ambiguous→out_of_scope)を最上位キーに保ち、確定行を先頭へ寄せる。
  attack.sort(compareAttackRows)

  return NextResponse.json({
    id: list.id,
    name: list.name,
    row_count: list.row_count,
    summary: summarize(attack),
    // 突合基準の as_of（自治体別）。confirmed 行が属する自治体の最新月。
    as_of_by_municipality: muniAsOf,
    rows: attack,
  })
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

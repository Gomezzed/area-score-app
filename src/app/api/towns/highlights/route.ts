import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { guardFeature } from '@/lib/subscription'

// GET /api/towns/highlights?muni_code=352080
//   Platinum 専用「注目町域 TOP20」。最新月を inferred_priority_rank(S>A>B>C>D)→
//   inferred_acquisition_score 降順で並べた上位20件を返す。
//   - 認可: T6 と同じ guardFeature('townAcquisitionPriority')（未認証401 / 非platinum403）。
//   - 取得: createSupabaseServerClient（authenticated）。RLS(platinum 限定SELECT)で二重防御。
//   - 原則1: 確定(confirmed)と推定(inferred)を別フィールドに分離。rankChange は推定ランクの
//            月次変化なので inferred 側に置く（確定とは混ぜない）。

const DEFAULT_MUNI_CODE = '352080' // デモは岩国のみ実データ投入済み（将来は選択エリア連動）
const TOP_N = 20

// ランク重み（小さいほど上位）。inferred_priority_rank は文字列のため、
// 単純な文字列ソートでは S が末尾に来てしまう。明示的に重み付けする。
const RANK_WEIGHT: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 }
function rankWeight(rank: string | null): number {
  if (rank == null) return 99
  return RANK_WEIGHT[rank] ?? 99
}

// numeric/integer を number | null へ正規化（PostgREST が numeric を文字列で返す場合に備える）。
function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

const COLUMNS = [
  'town_id',
  'town_name',
  'office_name',
  'as_of',
  // 確定（公表値・前年比）
  'confirmed_households_yoy_delta',
  'confirmed_population_yoy_delta',
  // 推定（ルールベース）
  'inferred_priority_rank',
  'inferred_acquisition_score',
  'inferred_demand_score',
  'inferred_sell_signal_score',
  'inferred_supply_event_score',
  'inferred_reason',
].join(',')

export async function GET(request: NextRequest) {
  // ── 認可（T6 の guard を再利用） ──
  const denied = await guardFeature('townAcquisitionPriority')
  if (denied) return denied

  const muniCode = request.nextUrl.searchParams.get('muni_code') ?? DEFAULT_MUNI_CODE
  const supabase = await createSupabaseServerClient()

  // 最新月
  const { data: latestRow, error: latestErr } = await supabase
    .from('town_monthly_metrics')
    .select('as_of')
    .eq('muni_code', muniCode)
    .order('as_of', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latestErr) {
    return NextResponse.json({ error: 'データ取得に失敗しました' }, { status: 500 })
  }
  if (!latestRow) {
    return NextResponse.json({ muniCode, asOf: null, prevAsOf: null, items: [] })
  }
  const asOf = latestRow.as_of as string

  // 前月（最新より前の最大 as_of）。無ければ rankChange は付けない。
  const { data: prevRow } = await supabase
    .from('town_monthly_metrics')
    .select('as_of')
    .eq('muni_code', muniCode)
    .lt('as_of', asOf)
    .order('as_of', { ascending: false })
    .limit(1)
    .maybeSingle()
  const prevAsOf = (prevRow?.as_of as string | undefined) ?? null

  // 最新月の全町域
  const { data, error } = await supabase
    .from('town_monthly_metrics')
    .select(COLUMNS)
    .eq('muni_code', muniCode)
    .eq('as_of', asOf)
  if (error) {
    return NextResponse.json({ error: 'データ取得に失敗しました' }, { status: 500 })
  }
  // COLUMNS は動的文字列のため型推論は効かない。unknown を挟んで明示変換する。
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>

  // 前月のランクマップ（town_id -> rank）
  const prevRankByTown = new Map<number, string | null>()
  if (prevAsOf) {
    const { data: prevData } = await supabase
      .from('town_monthly_metrics')
      .select('town_id,inferred_priority_rank')
      .eq('muni_code', muniCode)
      .eq('as_of', prevAsOf)
    const prevRows = (prevData ?? []) as unknown as Array<Record<string, unknown>>
    for (const r of prevRows) {
      prevRankByTown.set(r.town_id as number, (r.inferred_priority_rank as string | null) ?? null)
    }
  }

  // ランク重み → 取得スコア降順で並べ替え、TOP20 を抽出。
  const top = rows
    .slice()
    .sort((a, b) => {
      const wa = rankWeight((a.inferred_priority_rank as string | null) ?? null)
      const wb = rankWeight((b.inferred_priority_rank as string | null) ?? null)
      if (wa !== wb) return wa - wb
      const sa = num(a.inferred_acquisition_score) ?? -Infinity
      const sb = num(b.inferred_acquisition_score) ?? -Infinity
      return sb - sa
    })
    .slice(0, TOP_N)

  const items = top.map((r, i) => {
    const rank = (r.inferred_priority_rank as string | null) ?? null
    const townId = r.town_id as number

    // 推定ランクの前月比変化（up=上昇 / down=下降 / same=横ばい / new=前月になし / null=前月データなし）
    let rankChange: 'up' | 'down' | 'same' | 'new' | null = null
    if (prevAsOf) {
      if (!prevRankByTown.has(townId)) {
        rankChange = 'new'
      } else {
        const cw = rankWeight(rank)
        const pw = rankWeight(prevRankByTown.get(townId) ?? null)
        rankChange = cw < pw ? 'up' : cw > pw ? 'down' : 'same'
      }
    }

    return {
      position: i + 1,
      townId,
      townName: r.town_name as string,
      officeName: (r.office_name as string | null) ?? null,
      asOf: r.as_of as string,
      // 確定（公表値・前年比）
      confirmed: {
        householdsYoyDelta: num(r.confirmed_households_yoy_delta),
        populationYoyDelta: num(r.confirmed_population_yoy_delta),
      },
      // 推定（ルールベース・参考値）
      inferred: {
        priorityRank: rank,
        acquisitionScore: num(r.inferred_acquisition_score),
        demandScore: num(r.inferred_demand_score),
        sellSignalScore: num(r.inferred_sell_signal_score),
        supplyEventScore: num(r.inferred_supply_event_score),
        reason: (r.inferred_reason as string | null) ?? null,
        rankChange, // 推定ランクの月次変化（推定由来。確定とは混ぜない）
      },
    }
  })

  return NextResponse.json({ muniCode, asOf, prevAsOf, items })
}

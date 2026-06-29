import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { guardFeature } from '@/lib/subscription'
import { CENSUS } from '@/lib/census'

// GET /api/compare?a=<municipality_uuid>&b=<municipality_uuid>
//   2市区町村のエリア比較（Platinum 専用）。
//   - 認可: guardFeature('areaCompare')（未認証401 / 非Platinum403）。T6/T7/T9 と同作法。
//   - 確定(confirmed): 全国 census（municipalities + population_stats）。両エリア対等に取得。
//   - 推定(inferred): town_monthly_metrics を municipality_id で集計（最新月）。
//                     現状は岩国のみ投入済みのため、無いエリアは hasData:false を決定論返却。
//   - 原則1: confirmed と inferred を別フィールドに分離。推定は「集計で新スコアを捏造しない」=
//            事実カウント（ランク内訳）と既存値の最大（最高取得スコア）・既存 reason のみ。
//   - RLS二重防御: town_monthly_metrics は Platinum 限定SELECT(T3)。census は authenticated 可読。

type SupabaseServer = Awaited<ReturnType<typeof createSupabaseServerClient>>

function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

interface PopStatRow {
  year: number
  population: number | null
  households: number | null
  population_delta: number | null
  population_delta_rate: number | null
}

type InferredResult =
  | { hasData: false }
  | {
      hasData: true
      asOf: string
      townCount: number
      rankCounts: { S: number; A: number; B: number; C: number; D: number }
      topAcquisitionScore: number | null
      topReason: string | null
    }

// 1エリア分（確定＝census / 推定＝town_monthly_metrics集計）をまとめて取得。
async function loadArea(supabase: SupabaseServer, id: string) {
  // ── 確定（census）──
  const { data: m } = await supabase
    .from('municipalities')
    .select(
      'id, name, prefecture_code, station_passengers_total, population_stats(year, population, households, population_delta, population_delta_rate)',
    )
    .eq('id', id)
    .maybeSingle()

  if (!m) return null

  const stats = ((m.population_stats as PopStatRow[] | null) ?? [])
  const byYear = (y: number) => stats.find((s) => s.year === y)
  const sLatest = byYear(CENSUS.latest)
  const sPrev = byYear(CENSUS.prev)
  const sPrev2 = byYear(CENSUS.prev2)

  const confirmed = {
    popLatest: num(sLatest?.population),
    popPrev: num(sPrev?.population),
    popPrev2: num(sPrev2?.population),
    householdsLatest: num(sLatest?.households),
    delta: num(sLatest?.population_delta),
    deltaRate: num(sLatest?.population_delta_rate),
    stationPassengersTotal: num(m.station_passengers_total) ?? 0,
  }

  // ── 推定（town_monthly_metrics を municipality_id で集計・最新月）──
  const inferred = await loadInferred(supabase, id)

  return {
    id: m.id as string,
    name: m.name as string,
    prefectureCode: (m.prefecture_code as string | null) ?? null,
    confirmed,
    inferred,
  }
}

async function loadInferred(supabase: SupabaseServer, id: string): Promise<InferredResult> {
  // 最新月
  const { data: latestRow } = await supabase
    .from('town_monthly_metrics')
    .select('as_of')
    .eq('municipality_id', id)
    .order('as_of', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!latestRow) return { hasData: false }
  const asOf = latestRow.as_of as string

  const { data } = await supabase
    .from('town_monthly_metrics')
    .select('inferred_priority_rank, inferred_acquisition_score, inferred_reason')
    .eq('municipality_id', id)
    .eq('as_of', asOf)
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>
  if (rows.length === 0) return { hasData: false }

  const rankCounts = { S: 0, A: 0, B: 0, C: 0, D: 0 }
  let topAcquisitionScore: number | null = null
  let topReason: string | null = null
  for (const r of rows) {
    const rank = (r.inferred_priority_rank as string | null) ?? null
    if (rank && rank in rankCounts) rankCounts[rank as keyof typeof rankCounts] += 1
    const score = num(r.inferred_acquisition_score)
    if (score != null && (topAcquisitionScore == null || score > topAcquisitionScore)) {
      topAcquisitionScore = score
      topReason = (r.inferred_reason as string | null) ?? null
    }
  }

  return {
    hasData: true,
    asOf,
    townCount: rows.length,
    rankCounts,
    topAcquisitionScore,
    topReason,
  }
}

export async function GET(request: NextRequest) {
  // ── 認可（areaCompare = Platinum） ──
  const denied = await guardFeature('areaCompare')
  if (denied) return denied

  const a = request.nextUrl.searchParams.get('a')
  const b = request.nextUrl.searchParams.get('b')
  if (!a || !b) {
    return NextResponse.json(
      { error: 'クエリ a, b（比較する2市区町村の id）が必要です' },
      { status: 400 },
    )
  }

  const supabase = await createSupabaseServerClient()
  // 2エリアを並行取得（互いに独立）。
  const [areaA, areaB] = await Promise.all([loadArea(supabase, a), loadArea(supabase, b)])

  return NextResponse.json({ a: areaA, b: areaB })
}

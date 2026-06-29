import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { guardFeature } from '@/lib/subscription'
import { CENSUS } from '@/lib/census'

// GET /api/trade-area?municipality_id=<uuid>
//   商圏レポート用の市区町村サマリ（Platinum 専用）。PDF はクライアント生成（pdf.tsx）。
//   - 認可: guardFeature('tradeAreaReport')（未認証401 / 非Platinum403）。T10 と同作法。
//   - 確定(confirmed): census（municipalities + population_stats）+ 駅乗降客数合計。
//   - 推定(inferred): town_monthly_metrics を municipality_id で集計（最新月）。岩国のみ存在。
//   - 原則1: confirmed と inferred を別フィールドに分離。集計で新スコアを捏造せず、
//            ランク内訳=事実カウント / 最高取得スコア=既存値の最大 / reason=既存テキスト。
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

async function loadInferred(supabase: SupabaseServer, id: string): Promise<InferredResult> {
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

  return { hasData: true, asOf, townCount: rows.length, rankCounts, topAcquisitionScore, topReason }
}

async function loadArea(supabase: SupabaseServer, id: string) {
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

  return {
    id: m.id as string,
    name: m.name as string,
    prefectureCode: (m.prefecture_code as string | null) ?? null,
    confirmed: {
      popLatest: num(sLatest?.population),
      popPrev: num(sPrev?.population),
      popPrev2: num(sPrev2?.population),
      householdsLatest: num(sLatest?.households),
      delta: num(sLatest?.population_delta),
      deltaRate: num(sLatest?.population_delta_rate),
      stationPassengersTotal: num(m.station_passengers_total) ?? 0,
    },
    inferred: await loadInferred(supabase, id),
  }
}

export async function GET(request: NextRequest) {
  // ── 認可（tradeAreaReport = Platinum） ──
  const denied = await guardFeature('tradeAreaReport')
  if (denied) return denied

  const id = request.nextUrl.searchParams.get('municipality_id')
  if (!id) {
    return NextResponse.json(
      { error: 'municipality_id クエリパラメータが必要です' },
      { status: 400 },
    )
  }

  const supabase = await createSupabaseServerClient()
  const area = await loadArea(supabase, id)
  if (!area) {
    return NextResponse.json({ error: '市区町村が見つかりません' }, { status: 404 })
  }
  return NextResponse.json(area)
}

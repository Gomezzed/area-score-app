import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { guardFeature } from '@/lib/subscription'

// GET /api/towns?muni_code=352080[&as_of=YYYY-MM-DD]
//   Platinum の目玉「町域別 仕入れ優先度」を返す Route Handler。
//   - 認可: T1 の guardFeature('townAcquisitionPriority')（未認証 401 / 非platinum 403）。
//   - 取得: createSupabaseServerClient（anon/authenticated）で実行し RLS をそのまま効かせる。
//           → 万一 guard を擦り抜けても DB 側 RLS(platinum 限定 SELECT)が二重に防ぐ。新規クライアントは作らない。
//   - 原則1: 確定(confirmed)と推定(inferred)を別オブジェクトに分離して返し、絶対に混ぜない。

// numeric/integer を number | null へ正規化する。
//   PostgREST は numeric 型を JSON 文字列で返すことがあるため、ここで数値へ寄せる。
function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

// 取得対象の列（確定＝confirmed_* / 推定＝inferred_* / ディメンション）。
const COLUMNS = [
  'town_id',
  'town_name',
  'office_name',
  'as_of',
  // 確定（公表値・事実）
  'confirmed_households',
  'confirmed_population',
  'confirmed_households_yoy_delta',
  'confirmed_population_yoy_delta',
  // 推定（ルールベース・参考値）
  'inferred_demand_score',
  'inferred_sell_signal_score',
  'inferred_supply_event_score',
  'inferred_acquisition_score',
  'inferred_priority_rank',
  'inferred_reason',
].join(',')

export async function GET(request: NextRequest) {
  // ── 認可（T1 の guard を再利用。再実装しない） ──
  const denied = await guardFeature('townAcquisitionPriority')
  if (denied) return denied

  const muniCode = request.nextUrl.searchParams.get('muni_code')
  if (!muniCode) {
    return NextResponse.json(
      { error: 'muni_code クエリパラメータが必要です（例: ?muni_code=352080）' },
      { status: 400 },
    )
  }
  const asOfParam = request.nextUrl.searchParams.get('as_of')

  const supabase = await createSupabaseServerClient()

  // 対象月（as_of）の決定: 明示指定が無ければ当該自治体の最新月を採用。
  let asOf = asOfParam
  if (!asOf) {
    const { data: latest, error: latestErr } = await supabase
      .from('town_monthly_metrics')
      .select('as_of')
      .eq('muni_code', muniCode)
      .order('as_of', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latestErr) {
      return NextResponse.json({ error: 'データ取得に失敗しました' }, { status: 500 })
    }
    if (!latest) {
      // 行なし（RLS で 0 行 / 未投入自治体）。空配列で返す。
      return NextResponse.json({ muniCode, asOf: null, items: [] })
    }
    asOf = latest.as_of as string
  }

  // 取得スコアの高い順（S/A が上）に並べて取得。
  const { data, error } = await supabase
    .from('town_monthly_metrics')
    .select(COLUMNS)
    .eq('muni_code', muniCode)
    .eq('as_of', asOf)
    .order('inferred_acquisition_score', { ascending: false, nullsFirst: false })

  if (error) {
    return NextResponse.json({ error: 'データ取得に失敗しました' }, { status: 500 })
  }

  // COLUMNS は動的文字列のため supabase-js の型推論は効かない。unknown を挟んで明示変換する。
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>
  const items = rows.map((r) => ({
    townId: r.town_id as number,
    townName: r.town_name as string,
    officeName: (r.office_name as string | null) ?? null,
    asOf: r.as_of as string,
    // 確定（公表値・事実）— 推定とは別オブジェクト
    confirmed: {
      households: num(r.confirmed_households),
      population: num(r.confirmed_population),
      householdsYoyDelta: num(r.confirmed_households_yoy_delta),
      populationYoyDelta: num(r.confirmed_population_yoy_delta),
    },
    // 推定（ルールベース・参考値）— 必ず reason（計算根拠）を伴わせる
    inferred: {
      demandScore: num(r.inferred_demand_score),
      sellSignalScore: num(r.inferred_sell_signal_score),
      supplyEventScore: num(r.inferred_supply_event_score),
      acquisitionScore: num(r.inferred_acquisition_score),
      priorityRank: (r.inferred_priority_rank as string | null) ?? null,
      reason: (r.inferred_reason as string | null) ?? null,
    },
  }))

  return NextResponse.json({ muniCode, asOf, items })
}

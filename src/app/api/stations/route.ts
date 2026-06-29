import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { guardFeature } from '@/lib/subscription'

// GET /api/stations?municipality_id=<uuid>
//   駅単位ドリルダウン（市区町村内の駅ごとの乗降客数）。
//   - 認可: T6/T7 と同じ guardFeature。料金v2.1で駅単位は Standard 以上(stationLevelEntitled)。
//           未認証401 / standard未満(free/starter)403。※ Platinum 限定ではない。
//   - データ: public.stations（国交省 XKT015・全国投入済み）。全て確定値（推定列なし）。
//             stations の RLS は authenticated に開放（駅データは機密でない）ため、
//             駅単位機能の権限ゲートはこのアプリ層 guard が担う。
//   - 原則1: 駅指標は確定(confirmed)のみ。推定は存在しないため inferred は返さない（捏造しない）。

// numeric/integer を number | null へ正規化。
function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

const COLUMNS = ['id', 'name', 'operator', 'line_name', 'passengers_latest', 'passengers_year', 'lat', 'lng'].join(',')

export async function GET(request: NextRequest) {
  // ── 認可（駅単位 = Standard 以上） ──
  const denied = await guardFeature('stationLevelEntitled')
  if (denied) return denied

  const municipalityId = request.nextUrl.searchParams.get('municipality_id')
  if (!municipalityId) {
    return NextResponse.json(
      { error: 'municipality_id クエリパラメータが必要です' },
      { status: 400 },
    )
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('stations')
    .select(COLUMNS)
    .eq('municipality_id', municipalityId)
    .order('passengers_latest', { ascending: false, nullsFirst: false })

  if (error) {
    return NextResponse.json({ error: 'データ取得に失敗しました' }, { status: 500 })
  }

  // COLUMNS は動的文字列のため型推論は効かない。unknown を挟んで明示変換する。
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>
  const items = rows.map((r) => ({
    stationId: r.id as string,
    name: r.name as string,
    operator: (r.operator as string | null) ?? null,
    lineName: (r.line_name as string | null) ?? null,
    lat: num(r.lat),
    lng: num(r.lng),
    // 駅指標は全て確定（公表値）。推定値は持たない。
    confirmed: {
      passengersLatest: num(r.passengers_latest),
      passengersYear: num(r.passengers_year),
    },
  }))

  return NextResponse.json({ municipalityId, items })
}

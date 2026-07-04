import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { guardFeature } from '@/lib/subscription'

// GET /api/market-metrics?muni_code=<5桁数字>
//   相場・公示価格セクション用データ（Standard 以上）。
//   - 認可: guardFeature('marketMetricsEntitled')（未認証401 / free・starter 403）。
//           market_metrics のRLSもstandard+限定(mm_read_standard_plus・20260703000000)の
//           二重防御。アプリ層はここで forbidden メッセージを明示するために guard する。
//   - 原則1: confirmed(公表事実)とreference(参考・当社集計)を絶対に混ぜない。
//            value_type で判定し、レスポンス構造そのものを confirmed[] / reference[] に
//            分離して返す（キー名の混在を構造的に防ぐ）。
//   - property_type の絞り込み（農地・林地等を非表示にする等・D7）は行わない。
//     DBは全種別を保持し、UI側で表示種別を絞る（表示絞り込みはコンポーネント側の責務）。
//   - 1リクエスト=1自治体（muni_code）。県一括・全件エンドポイントは作らない。

const MUNI_CODE_RE = /^[0-9]{5}$/
const METRIC_TYPES = ['official_land_price', 'trade_price'] as const
const HISTORY_YEARS = 5

function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export async function GET(request: NextRequest) {
  // ── 認可（相場・公示価格 = Standard 以上） ──
  const denied = await guardFeature('marketMetricsEntitled')
  if (denied) return denied

  const muniCode = request.nextUrl.searchParams.get('muni_code')
  if (!muniCode || !MUNI_CODE_RE.test(muniCode)) {
    return NextResponse.json(
      { error: 'muni_code は5桁の数字で指定してください' },
      { status: 400 },
    )
  }

  const minYear = new Date().getFullYear() - HISTORY_YEARS

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('market_metrics')
    .select('metric_type, value_type, property_type, year, quarter, value, unit, sample_count')
    .eq('muni_code', muniCode)
    .in('metric_type', METRIC_TYPES)
    .gte('year', minYear)
    .order('year', { ascending: true })

  if (error) {
    return NextResponse.json({ error: 'データ取得に失敗しました' }, { status: 500 })
  }

  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>
  const confirmed: Array<Record<string, unknown>> = []
  const reference: Array<Record<string, unknown>> = []

  for (const r of rows) {
    const row = {
      metricType: r.metric_type as string,
      propertyType: r.property_type as string,
      year: r.year as number,
      quarter: num(r.quarter),
      value: num(r.value),
      unit: r.unit as string,
      sampleCount: num(r.sample_count),
    }
    // confirmed/reference の分離は value_type のみで判定する（原則1）。
    if (r.value_type === 'confirmed') confirmed.push(row)
    else if (r.value_type === 'reference') reference.push(row)
  }

  return NextResponse.json({ muniCode, confirmed, reference })
}

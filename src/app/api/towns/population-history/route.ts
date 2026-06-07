/**
 * ============================================================================
 *  /api/towns/population-history
 *  選択された町丁目の人口推移 (時点別スナップショット) を返す Route Handler
 * ============================================================================
 *  配置先: src/app/api/towns/population-history/route.ts
 *
 *  クエリパラメータ:
 *    townId    - towns.id (UUID)        ※ townId か townCode のどちらか必須
 *    townCode  - 国勢調査 KEY_CODE (11桁)
 *    source    - 'census' | 'jichidai' (省略時は全ソース)
 *
 *  レスポンス:
 *    {
 *      town: { id, full_name, city_name, oaza_name, chome_name, town_code },
 *      points: Array<{
 *        year, source,
 *        total_population, total_households, avg_household_size,
 *        age_0_14, age_15_19, age_20_29, age_30_39, age_40_49, age_50_64, age_65_plus,
 *        age_family_total, male_population, female_population
 *      }>
 *    }
 * ============================================================================
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic    = 'force-dynamic'
export const revalidate = 0

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase env vars are not configured')
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const townId   = searchParams.get('townId')
    const townCode = searchParams.get('townCode')
    const source   = searchParams.get('source') // 'census' | 'jichidai' | null

    if (!townId && !townCode) {
      return NextResponse.json(
        { error: 'townId or townCode is required' },
        { status: 400 },
      )
    }

    const supabase = getSupabase()

    // town メタ情報を取得
    const townQuery = supabase
      .from('towns')
      .select('id, full_name, city_name, oaza_name, chome_name, town_code')
    const { data: town, error: townErr } = townId
      ? await townQuery.eq('id', townId).single()
      : await townQuery.eq('town_code', townCode!).single()

    if (townErr || !town) {
      return NextResponse.json({ error: 'town not found' }, { status: 404 })
    }

    // スナップショット (時系列) を取得
    let snapQuery = supabase
      .from('town_population_snapshots')
      .select(
        'survey_year, source, total_population, total_households, avg_household_size,' +
        ' age_0_14, age_15_19, age_20_29, age_30_39, age_40_49, age_50_64, age_65_plus,' +
        ' age_family_total, male_population, female_population',
      )
      .eq('town_id', town.id)
      .order('survey_year', { ascending: true })

    if (source) snapQuery = snapQuery.eq('source', source)

    const { data: snaps, error: snapErr } = await snapQuery.returns<Snap[]>()
    if (snapErr) {
      return NextResponse.json({ error: snapErr.message }, { status: 500 })
    }

    type Snap = {
      survey_year:        number
      source:             string
      total_population:   number
      total_households:   number
      avg_household_size: number
      age_0_14:           number
      age_15_19:          number
      age_20_29:          number
      age_30_39:          number
      age_40_49:          number
      age_50_64:          number
      age_65_plus:        number
      age_family_total:   number
      male_population:    number | null
      female_population:  number | null
    }

    const points = (snaps ?? []).map((s: Snap) => ({
      year:               s.survey_year,
      source:             s.source,
      total_population:   s.total_population,
      total_households:   s.total_households,
      avg_household_size: s.avg_household_size,
      age_0_14:           s.age_0_14,
      age_15_19:          s.age_15_19,
      age_20_29:          s.age_20_29,
      age_30_39:          s.age_30_39,
      age_40_49:          s.age_40_49,
      age_50_64:          s.age_50_64,
      age_65_plus:        s.age_65_plus,
      age_family_total:   s.age_family_total,
      male_population:    s.male_population,
      female_population:  s.female_population,
    }))

    return NextResponse.json(
      { town, points },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

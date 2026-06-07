/**
 * ============================================================================
 *  /api/towns/young-family-inflow
 *  町丁目別「若返り・ファミリー流入」ランキング API (Next.js Route Handler)
 * ============================================================================
 *  配置先: src/app/api/towns/young-family-inflow/route.ts
 *
 *  クエリパラメータ:
 *    cityId        - cities.id (UUID)    ※ cityId か city のどちらか必須
 *    city          - cities.name_en      (例: "kagoshima")
 *    inflowOnly    - "true" にすると is_young_family_inflow=true のみ
 *    sortBy        - inflow_score | population_delta_abs | family_index |
 *                    young_family_delta_pct  (既定: inflow_score)
 *    sortDir       - asc | desc (既定: desc)
 *    limit         - 1〜1000 (既定: 200)
 *    baseYear      - 任意。指定があれば WHERE base_year = X
 *    targetYear    - 任意。指定があれば WHERE target_year = X
 *
 *  レスポンス:
 *    {
 *      city_id: string,
 *      count:   number,
 *      rows: Array<InflowRow>
 *    }
 * ============================================================================
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic  = 'force-dynamic'
export const revalidate = 0

const ALLOWED_SORT_KEYS = new Set([
  'inflow_score',
  'population_delta_abs',
  'population_delta_pct',
  'family_index',
  'young_family_delta_pct',
  'young_family_delta_abs',
])

type InflowRow = {
  town_id:                 string
  town_name:               string
  city_name:               string
  oaza_name:               string
  chome_name:              string | null
  inflow_score:            number
  is_young_family_inflow:  boolean
  population_delta_abs:    number
  population_delta_pct:    number
  households_delta_abs:    number
  family_index:            number
  young_family_delta_abs:  number
  young_family_delta_pct:  number
  base_year:               number
  target_year:             number
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('Supabase env vars are not configured')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)

    const cityIdParam   = searchParams.get('cityId')
    const cityNameParam = searchParams.get('city')
    const inflowOnly    = searchParams.get('inflowOnly') === 'true'
    const sortByRaw     = searchParams.get('sortBy') ?? 'inflow_score'
    const sortDirRaw    = searchParams.get('sortDir') ?? 'desc'
    const limit         = Math.min(
      Math.max(parseInt(searchParams.get('limit') ?? '200', 10) || 200, 1),
      1000,
    )
    const baseYear   = searchParams.get('baseYear')
    const targetYear = searchParams.get('targetYear')

    if (!cityIdParam && !cityNameParam) {
      return NextResponse.json(
        { error: 'cityId or city query parameter is required' },
        { status: 400 },
      )
    }

    const sortBy  = ALLOWED_SORT_KEYS.has(sortByRaw) ? sortByRaw : 'inflow_score'
    const sortAsc = sortDirRaw === 'asc'

    const supabase = getSupabase()

    // city_id を解決 (name_en 指定の場合)
    let cityId = cityIdParam
    if (!cityId && cityNameParam) {
      const { data: city, error: cityErr } = await supabase
        .from('cities')
        .select('id')
        .eq('name_en', cityNameParam)
        .single()
      if (cityErr || !city) {
        return NextResponse.json(
          { error: `city not found: ${cityNameParam}` },
          { status: 404 },
        )
      }
      cityId = city.id
    }

    // town_demographics × towns を JOIN 取得
    let query = supabase
      .from('town_demographics')
      .select(
        `
        town_id,
        base_year,
        target_year,
        inflow_score,
        is_young_family_inflow,
        population_delta_abs,
        population_delta_pct,
        households_delta_abs,
        family_index,
        young_family_delta_abs,
        young_family_delta_pct,
        towns!inner (
          full_name,
          city_name,
          oaza_name,
          chome_name,
          city_id
        )
        `,
      )
      .eq('towns.city_id', cityId as string)
      .order(sortBy, { ascending: sortAsc })
      .limit(limit)

    if (inflowOnly)   query = query.eq('is_young_family_inflow', true)
    if (baseYear)     query = query.eq('base_year',   parseInt(baseYear,   10))
    if (targetYear)   query = query.eq('target_year', parseInt(targetYear, 10))

    const { data, error } = await query
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    type RawRow = {
      town_id:                string
      base_year:              number
      target_year:            number
      inflow_score:           number
      is_young_family_inflow: boolean
      population_delta_abs:   number
      population_delta_pct:   number
      households_delta_abs:   number
      family_index:           number
      young_family_delta_abs: number
      young_family_delta_pct: number
      towns: {
        full_name:  string
        city_name:  string
        oaza_name:  string
        chome_name: string | null
        city_id:    string
      } | null
    }

    const rows: InflowRow[] = ((data ?? []) as unknown as RawRow[]).map((r) => ({
      town_id:                r.town_id,
      town_name:              r.towns?.full_name  ?? '',
      city_name:              r.towns?.city_name  ?? '',
      oaza_name:              r.towns?.oaza_name  ?? '',
      chome_name:             r.towns?.chome_name ?? null,
      inflow_score:           r.inflow_score,
      is_young_family_inflow: r.is_young_family_inflow,
      population_delta_abs:   r.population_delta_abs,
      population_delta_pct:   r.population_delta_pct,
      households_delta_abs:   r.households_delta_abs,
      family_index:           r.family_index,
      young_family_delta_abs: r.young_family_delta_abs,
      young_family_delta_pct: r.young_family_delta_pct,
      base_year:              r.base_year,
      target_year:            r.target_year,
    }))

    return NextResponse.json(
      { city_id: cityId, count: rows.length, rows },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

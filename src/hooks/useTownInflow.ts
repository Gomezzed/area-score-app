/**
 * ============================================================================
 *  src/hooks/useTownInflow.ts
 *  町丁目 若返り・ファミリー流入ランキング / 人口推移 取得フック
 * ============================================================================
 */
'use client'

import { useEffect, useState, useCallback } from 'react'
import type {
  InflowRankingRow,
  InflowFilters,
  InflowSortKey,
} from '@/types/town'

// ----------------------------------------------------------------------------
// 1. ランキング取得
// ----------------------------------------------------------------------------
export function useTownInflowRanking(
  cityNameEn: string | null,
  options: Omit<InflowFilters, 'cityName' | 'cityId'> = {},
) {
  const [rows, setRows]       = useState<InflowRankingRow[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError]     = useState<string | null>(null)

  const {
    inflowOnly = false,
    sortBy     = 'inflow_score',
    sortDir    = 'desc',
    limit      = 300,
    baseYear,
    targetYear,
  } = options

  const fetchRanking = useCallback(async () => {
    if (!cityNameEn) {
      setRows([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        city:    cityNameEn,
        sortBy,
        sortDir,
        limit:   String(limit),
      })
      if (inflowOnly)        params.set('inflowOnly', 'true')
      if (baseYear   != null) params.set('baseYear',   String(baseYear))
      if (targetYear != null) params.set('targetYear', String(targetYear))

      const res = await fetch(
        `/api/towns/young-family-inflow?${params.toString()}`,
        { cache: 'no-store' },
      )
      if (!res.ok) {
        // 町丁目データが未投入の都道府県では 404/空配列が想定される。エラーには昇格させない。
        const body = await res.json().catch(() => ({}))
        if (res.status === 404) {
          setRows([])
          return
        }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const json = await res.json()
      setRows(json.rows ?? [])
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown error'
      console.warn('[useTownInflowRanking]', msg)
      setError(msg)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [cityNameEn, inflowOnly, sortBy, sortDir, limit, baseYear, targetYear])

  useEffect(() => { fetchRanking() }, [fetchRanking])

  return { rows, loading, error, refetch: fetchRanking }
}

// ----------------------------------------------------------------------------
// 2. 人口推移 (時系列) 取得
// ----------------------------------------------------------------------------
export interface PopulationPoint {
  year:               number
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
}

export interface PopulationHistoryResult {
  town:   {
    id:          string
    full_name:   string
    city_name:   string
    oaza_name:   string
    chome_name:  string | null
    town_code:   string
  } | null
  points: PopulationPoint[]
}

export function useTownPopulationHistory(townId: string | null) {
  const [data, setData]       = useState<PopulationHistoryResult>({ town: null, points: [] })
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    if (!townId) {
      setData({ town: null, points: [] })
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/towns/population-history?townId=${encodeURIComponent(townId)}`, {
      cache: 'no-store',
    })
      .then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
        if (!cancelled) setData(body)
      })
      .catch((e) => {
        if (!cancelled) {
          console.warn('[useTownPopulationHistory]', e.message)
          setError(e.message)
          setData({ town: null, points: [] })
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [townId])

  return { data, loading, error }
}

// ----------------------------------------------------------------------------
// 3. クライアント側ソート (テーブル上でのソート切替に使用)
// ----------------------------------------------------------------------------
export function sortInflowRows(
  rows: InflowRankingRow[],
  key:  InflowSortKey,
  asc:  boolean,
): InflowRankingRow[] {
  const copy = [...rows]
  copy.sort((a, b) => {
    const av = (a as unknown as Record<string, number>)[key] ?? 0
    const bv = (b as unknown as Record<string, number>)[key] ?? 0
    return asc ? av - bv : bv - av
  })
  return copy
}

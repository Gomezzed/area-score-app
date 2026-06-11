'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Prefecture, MunicipalityWithStats, PopulationStat } from '@/types'

// 全都道府県（コード順）
export function usePrefectures() {
  const [prefectures, setPrefectures] = useState<Prefecture[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchPrefectures = useCallback(async () => {
    setLoading(true)
    // セッション初期化完了を待つ（OAuth直後・直接アクセス時のレース対策）
    await supabase.auth.getSession()
    const { data, error: err } = await supabase
      .from('prefectures')
      .select('*')
      .order('code')

    if (err) {
      console.error('[usePrefectures] error:', err.code, err.message)
      setError(err.message)
    } else {
      setPrefectures(data ?? [])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchPrefectures()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // INITIAL_SESSION: 既存セッションでのページロード時に発火（OAuth後・直接アクセス）
      if (
        (event === 'INITIAL_SESSION' && session) ||
        event === 'SIGNED_IN' ||
        event === 'TOKEN_REFRESHED'
      ) {
        fetchPrefectures()
      }
    })
    return () => subscription.unsubscribe()
  }, [fetchPrefectures])

  return { prefectures, loading, error }
}

interface MuniRow {
  id: string
  prefecture_code: string
  city_code: string | null
  name: string
  lat: number | null
  lng: number | null
  station_passengers_total: number | null
  population_stats: PopulationStat[]
}

// 指定都道府県の市区町村 + 2015/2020 統計
export function useMunicipalities(prefectureCode: string) {
  const [municipalities, setMunicipalities] = useState<MunicipalityWithStats[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchMunicipalities = useCallback(async (code: string) => {
    setLoading(true)
    // セッション初期化完了を待つ（OAuth直後・直接アクセス時のレース対策）
    await supabase.auth.getSession()
    const { data, error: err } = await supabase
      .from('municipalities')
      .select('id, prefecture_code, city_code, name, lat, lng, station_passengers_total, population_stats(year, population, households, population_delta, population_delta_rate)')
      .eq('prefecture_code', code)

    if (err) {
      console.error('[useMunicipalities] error:', err.code, err.message)
      setError(err.message)
      setMunicipalities([])
      setLoading(false)
      return
    }

    const rows = (data ?? []) as unknown as MuniRow[]
    const flattened: MunicipalityWithStats[] = rows.map((m) => {
      const s2020 = m.population_stats?.find((s) => s.year === 2020)
      const s2015 = m.population_stats?.find((s) => s.year === 2015)
      return {
        id: m.id,
        prefecture_code: m.prefecture_code,
        city_code: m.city_code,
        name: m.name,
        lat: m.lat,
        lng: m.lng,
        pop2020: s2020?.population ?? null,
        pop2015: s2015?.population ?? null,
        households2020: s2020?.households ?? null,
        delta: s2020?.population_delta ?? null,
        deltaRate: s2020?.population_delta_rate ?? null,
        stationPassengersTotal: m.station_passengers_total ?? 0,
      }
    })

    // 人口（2020）降順
    flattened.sort((a, b) => (b.pop2020 ?? -1) - (a.pop2020 ?? -1))

    setMunicipalities(flattened)
    setError(null)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!prefectureCode) return
    fetchMunicipalities(prefectureCode)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // INITIAL_SESSION: 既存セッションでのページロード時に発火（OAuth後・直接アクセス）
      if (
        (event === 'INITIAL_SESSION' && session) ||
        event === 'SIGNED_IN' ||
        event === 'TOKEN_REFRESHED'
      ) {
        fetchMunicipalities(prefectureCode)
      }
    })
    return () => subscription.unsubscribe()
  }, [prefectureCode, fetchMunicipalities])

  return { municipalities, loading, error }
}

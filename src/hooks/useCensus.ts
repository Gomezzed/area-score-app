'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Prefecture, MunicipalityWithStats } from '@/types'

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

// get_municipalities_gated RPC の1行（プラン別ゲート済み。ロック行は数値/緯度経度が NULL）。
interface GatedMuniRow {
  id: string
  prefecture_code: string
  city_code: string | null
  name: string
  lat: number | null
  lng: number | null
  station_passengers_total: number | null
  pop_latest: number | null
  pop_prev: number | null
  pop_prev2: number | null
  households_latest: number | null
  delta: number | null
  delta_rate: number | null
  is_designated_city: boolean
  parent_city_code: string | null
  locked: boolean
}

// 指定都道府県の市区町村 + 国勢調査統計（2025速報 / 2020 / 2015）。
//   H1 対策: テーブル直読みではなく get_municipalities_gated RPC を全プラン共通で使用する。
//   Free 閲覧ルール v3 のゲート（ロック行の数値 NULL 化・上位N件判定）はサーバー側で確定し、
//   ロック行は数値/緯度経度が既に NULL で届く（クライアントでのマスクは行わない）。
export function useMunicipalities(prefectureCode: string) {
  const [municipalities, setMunicipalities] = useState<MunicipalityWithStats[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchMunicipalities = useCallback(async (code: string) => {
    setLoading(true)
    // セッション初期化完了を待つ（OAuth直後・直接アクセス時のレース対策）
    await supabase.auth.getSession()
    const { data, error: err } = await supabase
      .rpc('get_municipalities_gated', { p_pref_code: code })

    if (err) {
      console.error('[useMunicipalities] error:', err.code, err.message)
      setError(err.message)
      setMunicipalities([])
      setLoading(false)
      return
    }

    const rows = (data ?? []) as GatedMuniRow[]
    const flattened: MunicipalityWithStats[] = rows.map((m) => ({
      id: m.id,
      prefecture_code: m.prefecture_code,
      city_code: m.city_code,
      name: m.name,
      lat: m.lat,
      lng: m.lng,
      popLatest: m.pop_latest,
      popPrev: m.pop_prev,
      popPrev2: m.pop_prev2,
      householdsLatest: m.households_latest,
      delta: m.delta,
      deltaRate: m.delta_rate,
      stationPassengersTotal: m.station_passengers_total ?? 0,
      locked: m.locked,
    }))

    // 並び順は RPC（真の 2025 人口降順・マスク前値）を信頼し、クライアント側で再ソートしない。
    //   ロック行は popLatest が NULL のため、ここで人口ソートすると順位が壊れる。
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

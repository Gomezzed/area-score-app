'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { PopulationHistoryPoint } from '@/types'

// 指定市区町村の人口推移（2015〜2025）を取得する。
//   H1 対策: municipalities.population_history の直読みではなく
//   get_population_history_gated(p_city_code) RPC を使用する。
//   Free でロック対象コードの場合はサーバー側で空集合が返る（グラフは「データ準備中」表示）。
//   キーは city_code（5桁 JIS）。RPC は {year, population} の行集合を年昇順で返す。
//
//   セッション確立レース対策は useMunicipalities / usePrefectures と同一イディオムに揃える。
//   ディープリンク初回マウントでは cookie→クライアントのハイドレーション完了前に
//   getSession() が解決し得るため、await だけでは anon コンテキストで RPC が発火し 401 になる。
//   onAuthStateChange(INITIAL_SESSION) 発火時に再取得することで authenticated で確実に叩く。
export function usePopulationHistory(cityCode: string | null) {
  const [data, setData] = useState<PopulationHistoryPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const fetchHistory = useCallback(async (code: string) => {
    setLoading(true)
    // セッション初期化完了を待つ（OAuth直後・直接アクセス時のレース対策）
    await supabase.auth.getSession()
    const { data: rows, error: err } = await supabase
      .rpc('get_population_history_gated', { p_city_code: code })

    if (err) {
      console.error('[usePopulationHistory] error:', err.code, err.message)
      setError(new Error(err.message))
      setData([])
      setLoading(false)
      return
    }

    // RPC は年昇順で返すが、格納順に依存しないよう明示的に昇順整列する。
    const history = (rows ?? []) as PopulationHistoryPoint[]
    setData([...history].sort((a, b) => a.year - b.year))
    setError(null)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!cityCode) {
      setData([])
      setError(null)
      return
    }

    fetchHistory(cityCode)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // INITIAL_SESSION: 既存セッションでのページロード時に発火（OAuth後・直接アクセス）
      if (
        (event === 'INITIAL_SESSION' && session) ||
        event === 'SIGNED_IN' ||
        event === 'TOKEN_REFRESHED'
      ) {
        fetchHistory(cityCode)
      }
    })
    return () => subscription.unsubscribe()
  }, [cityCode, fetchHistory])

  return { data, loading, error }
}

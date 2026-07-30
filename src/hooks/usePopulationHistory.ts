'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { PopulationHistoryPoint } from '@/types'

// 指定市区町村の人口推移（2015〜2025）を取得する。
//   H1 対策: municipalities.population_history の直読みではなく
//   get_population_history_gated(p_city_code) RPC を使用する。
//   Free でロック対象コードの場合はサーバー側で空集合が返る（グラフは「データ準備中」表示）。
//   キーは city_code（5桁 JIS）。RPC は {year, population} の行集合を年昇順で返す。
export function usePopulationHistory(cityCode: string | null) {
  const [data, setData] = useState<PopulationHistoryPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!cityCode) {
      setData([])
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)

    ;(async () => {
      // セッション初期化完了を待つ（OAuth直後・直接アクセス時のレース対策）
      await supabase.auth.getSession()
      const { data: rows, error: err } = await supabase
        .rpc('get_population_history_gated', { p_city_code: cityCode })
      if (cancelled) return
      if (err) {
        console.error('[usePopulationHistory] error:', err.code, err.message)
        setError(new Error(err.message))
        setData([])
      } else {
        // RPC は年昇順で返すが、格納順に依存しないよう明示的に昇順整列する。
        const history = (rows ?? []) as PopulationHistoryPoint[]
        setData([...history].sort((a, b) => a.year - b.year))
        setError(null)
      }
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [cityCode])

  return { data, loading, error }
}

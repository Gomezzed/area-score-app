'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { PopulationHistoryPoint } from '@/types'

// 指定市区町村の人口推移（2015〜2025）を取得する。
// useTransactions と同じパターン（cancelled ガード + .then チェーン）に揃える。
// population_history が null の場合は空配列を返す。
export function usePopulationHistory(municipalityId: string) {
  const [data, setData] = useState<PopulationHistoryPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!municipalityId) {
      setData([])
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)

    ;(async () => {
      // セッション初期化完了を待つ（OAuth直後・直接アクセス時のレース対策）
      await supabase.auth.getSession()
      const { data: row, error: err } = await supabase
        .from('municipalities')
        .select('population_history')
        .eq('id', municipalityId)
        .single()
      if (cancelled) return
      if (err) {
        console.error('[usePopulationHistory] error:', err.code, err.message)
        setError(new Error(err.message))
        setData([])
      } else {
        const history = (row?.population_history ?? []) as PopulationHistoryPoint[]
        // 年の昇順に整列（DB 側の格納順に依存しない）
        setData([...history].sort((a, b) => a.year - b.year))
        setError(null)
      }
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [municipalityId])

  return { data, loading, error }
}

'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { RealEstateTransaction, TransactionYearSummary } from '@/types'

// 四半期データを年単位に集計（件数で加重平均）
function summarizeByYear(rows: RealEstateTransaction[]): TransactionYearSummary[] {
  const byYear = new Map<number, RealEstateTransaction[]>()
  for (const r of rows) {
    const arr = byYear.get(r.year) ?? []
    arr.push(r)
    byYear.set(r.year, arr)
  }

  const weightedAvg = (
    items: RealEstateTransaction[],
    pick: (r: RealEstateTransaction) => number | null,
  ): number | null => {
    let wsum = 0
    let w = 0
    for (const r of items) {
      const v = pick(r)
      const cnt = r.transaction_count ?? 0
      if (v != null && cnt > 0) {
        wsum += v * cnt
        w += cnt
      }
    }
    return w > 0 ? wsum / w : null
  }

  const summaries: TransactionYearSummary[] = []
  for (const [year, items] of byYear) {
    summaries.push({
      year,
      count: items.reduce((s, r) => s + (r.transaction_count ?? 0), 0),
      avgPriceManYen: weightedAvg(items, (r) => r.avg_price_man_yen),
      avgPricePerSqm: weightedAvg(items, (r) => r.avg_price_per_sqm),
      avgAreaSqm: weightedAvg(items, (r) => r.avg_area_sqm),
    })
  }
  summaries.sort((a, b) => a.year - b.year)
  return summaries
}

// 指定市区町村の不動産取引履歴（年別サマリ）を取得
export function useTransactions(municipalityId: string | null) {
  const [yearly, setYearly] = useState<TransactionYearSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!municipalityId) {
      setYearly([])
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)

    supabase
      .from('real_estate_transactions')
      .select('id, municipality_id, prefecture_code, city_code, year, quarter, transaction_count, avg_price_man_yen, avg_price_per_sqm, avg_area_sqm')
      .eq('municipality_id', municipalityId)
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) {
          console.error('[useTransactions] error:', err.code, err.message)
          setError(err.message)
          setYearly([])
        } else {
          setYearly(summarizeByYear((data ?? []) as RealEstateTransaction[]))
          setError(null)
        }
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [municipalityId])

  return { yearly, loading, error }
}

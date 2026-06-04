'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface TxSummary {
  year: number
  count: number
  avg_price_per_sqm: number
  avg_total_price: number
}

export function useTransactionSummary(cityName: string) {
  const [data, setData] = useState<TxSummary[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!cityName) { setData([]); return }
    setLoading(true)

    supabase
      .from('real_estate_transactions')
      .select('year, price_per_sqm, total_price')
      .eq('city_name', cityName)
      .order('year')
      .then(({ data: rows, error }) => {
        setLoading(false)
        // Gracefully handle missing table (42P01 = undefined_table)
        if (error) {
          if (error.code !== '42P01') {
            console.warn('[useTransactions]', error.message)
          }
          setData([])
          return
        }
        if (!rows || rows.length === 0) { setData([]); return }

        const byYear: Record<number, { prices: number[]; totals: number[]; count: number }> = {}
        for (const r of rows) {
          if (!byYear[r.year]) byYear[r.year] = { prices: [], totals: [], count: 0 }
          byYear[r.year].count++
          if (r.price_per_sqm != null) byYear[r.year].prices.push(Number(r.price_per_sqm))
          if (r.total_price != null)   byYear[r.year].totals.push(Number(r.total_price))
        }

        const summary: TxSummary[] = Object.entries(byYear).map(([yr, v]) => ({
          year:               Number(yr),
          count:              v.count,
          avg_price_per_sqm:  v.prices.length > 0
            ? Math.round(v.prices.reduce((s, x) => s + x, 0) / v.prices.length) : 0,
          avg_total_price:    v.totals.length > 0
            ? Math.round(v.totals.reduce((s, x) => s + x, 0) / v.totals.length) : 0,
        }))

        setData(summary.sort((a, b) => a.year - b.year))
      })
  }, [cityName])

  return { data, loading }
}

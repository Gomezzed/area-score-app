'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Area, City } from '@/types'

export function useCities() {
  const [cities, setCities] = useState<City[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchCities = useCallback(async () => {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('cities')
      .select('*')
      .order('name')
    if (err) {
      console.error('[useCities]', err.message)
      setError(err.message)
    } else {
      setCities(data ?? [])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchCities()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') fetchCities()
    })
    return () => subscription.unsubscribe()
  }, [fetchCities])

  return { cities, loading, error }
}

export function useAreas(cityId: string) {
  const [areas, setAreas] = useState<Area[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchAreas = useCallback(async (id: string) => {
    if (!id) { setAreas([]); setLoading(false); return }
    setLoading(true)
    const { data, error: err } = await supabase
      .from('areas')
      .select('*')
      .eq('city_id', id)
      .order('transaction_count', { ascending: false })
    if (err) {
      console.error('[useAreas]', err.message)
      setError(err.message)
      setAreas([])
    } else {
      setAreas(data ?? [])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAreas(cityId)
  }, [cityId, fetchAreas])

  return { areas, loading, error, refetch: () => fetchAreas(cityId) }
}

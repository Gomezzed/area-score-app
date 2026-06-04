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
    const { data, error: fetchError } = await supabase
      .from('cities')
      .select('*')
      .order('name')

    if (fetchError) {
      console.error('[useCities] error:', fetchError.code, fetchError.message, fetchError.details)
      setError(fetchError.message)
    } else {
      console.log('[useCities] loaded:', data?.length, 'cities')
      setCities(data ?? [])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchCities()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        fetchCities()
      }
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
    setLoading(true)
    const { data, error: fetchError } = await supabase
      .from('areas')
      .select('*')
      .eq('city_id', id)
      .order('transaction_count', { ascending: false })

    if (fetchError) {
      console.error('[useAreas] error:', fetchError.code, fetchError.message, fetchError.details)
      setError(fetchError.message)
    } else {
      console.log('[useAreas] loaded:', data?.length, 'areas for city:', id)
      setAreas(data ?? [])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!cityId) return
    fetchAreas(cityId)
  }, [cityId, fetchAreas])

  return { areas, loading, error, refetch: () => fetchAreas(cityId) }
}

'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Area, City } from '@/types'

export function useCities() {
  const [cities, setCities] = useState<City[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('cities')
      .select('*')
      .order('name')
      .then(({ data }) => {
        setCities(data ?? [])
        setLoading(false)
      })
  }, [])

  return { cities, loading }
}

export function useAreas(cityId: string) {
  const [areas, setAreas] = useState<Area[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!cityId) return
    setLoading(true)
    supabase
      .from('areas')
      .select('*')
      .eq('city_id', cityId)
      .then(({ data }) => {
        setAreas(data ?? [])
        setLoading(false)
      })
  }, [cityId])

  return { areas, loading }
}

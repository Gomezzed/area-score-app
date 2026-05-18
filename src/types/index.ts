export type Tier = 'A' | 'B' | 'C'

export type SortKey = 'score' | 'transaction_count' | 'population_delta'

export interface City {
  id: string
  name: string
  name_en: string
  center_lat: number
  center_lng: number
  zoom_level: number
  created_at: string
}

export interface Area {
  id: string
  city_id: string
  name: string
  population_delta: number
  transaction_count: number
  avg_price_level: number
  score: number
  tier: Tier
  geojson: GeoJSON.Feature | null
  created_at: string
  updated_at: string
}

export interface AreaWithCity extends Area {
  city: City
}

export interface DashboardFilters {
  cityId: string
  tiers: Tier[]
  sortKey: SortKey
  sortAsc: boolean
}

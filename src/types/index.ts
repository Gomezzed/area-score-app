/**
 * Column semantics in `areas` table (reused from original schema):
 *   transaction_count  → 人口（最新）
 *   avg_price_level    → 人口増減数（前回比）  [can be negative]
 *   population_delta   → 人口増減率（%）
 */

export type SortKey = 'transaction_count' | 'population_delta' | 'avg_price_level'

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
  population_delta: number   // 人口増減率（%）
  transaction_count: number  // 人口（最新）
  avg_price_level: number    // 人口増減数（前回比）
  geojson: GeoJSON.Feature | null
  created_at: string
  updated_at: string
}

export interface AreaWithCity extends Area {
  city: City
}

export interface DashboardFilters {
  sortKey: SortKey
  sortAsc: boolean
  search: string
}

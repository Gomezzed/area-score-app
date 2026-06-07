/**
 * ============================================================================
 *  src/types/town.ts
 *  町丁目（町域）粒度のドメイン型定義
 * ============================================================================
 *  既存の src/types/index.ts (Area / City) はそのまま維持し、
 *  町丁目関連の新規型はこのファイルに切り出します。
 *  将来的に必要に応じて index.ts から re-export してください。
 * ============================================================================
 */

import type { FeatureCollection, Feature } from 'geojson'

// ----------------------------------------------------------------------------
// マスター
// ----------------------------------------------------------------------------
export interface Town {
  id:              string
  city_id:         string
  town_code:       string          // 国勢調査 KEY_CODE (11桁)
  prefecture_name: string
  city_name:       string
  oaza_name:       string
  chome_name:      string | null
  full_name:       string          // 例: "鹿児島市鴨池1丁目"
  center_lat:      number | null
  center_lng:      number | null
  geojson:         Feature | FeatureCollection | null
  created_at:      string
  updated_at:      string
}

// ----------------------------------------------------------------------------
// 国勢調査スナップショット (時点別)
// ----------------------------------------------------------------------------
export type SnapshotSource = 'census' | 'jichidai'

export interface TownPopulationSnapshot {
  id:                   string
  town_id:              string
  survey_year:          number          // 2015, 2020 など
  source:               SnapshotSource
  total_population:     number
  total_households:     number
  avg_household_size:   number          // GENERATED: pop / hh
  age_0_14:             number
  age_15_19:            number
  age_20_29:            number
  age_30_39:            number
  age_40_49:            number
  age_50_64:            number
  age_65_plus:          number
  age_family_total:     number          // GENERATED: age_20_29 + age_30_39 + age_40_49
  male_population:      number | null
  female_population:    number | null
  source_stats_data_id: string | null
  created_at:           string
}

// ----------------------------------------------------------------------------
// 若返り・ファミリー流入 判定結果
// ----------------------------------------------------------------------------
export interface TownDemographics {
  id:                       string
  town_id:                  string
  base_year:                number
  target_year:              number

  // 人口
  base_population:          number
  target_population:        number
  population_delta_abs:     number      // 増加数 (負も可)
  population_delta_pct:     number      // 増加率(%)

  // 世帯
  base_households:          number
  target_households:        number
  households_delta_abs:     number
  households_delta_pct:     number

  // 派生指標
  family_index:             number      // GENERATED: pop_delta_abs - hh_delta_abs
  avg_household_size_delta: number

  // 若返り (20-49歳)
  young_family_pop_base:    number
  young_family_pop_target:  number
  young_family_delta_abs:   number
  young_family_delta_pct:   number

  // スコア・フラグ
  inflow_score:             number      // 0-100
  is_young_family_inflow:   boolean

  // メタ
  scoring_config_snapshot:  Record<string, number> | null
  computed_at:              string
}

export interface TownDemographicsWithTown extends TownDemographics {
  town: Town
}

// ----------------------------------------------------------------------------
// スコア計算 設定 (シングルトン)
// ----------------------------------------------------------------------------
export interface ScoringConfig {
  id:                                 number   // 1 固定
  // 若返り判定の閾値
  young_family_min_pop_delta_pct:     number
  young_family_min_family_index:      number
  young_family_min_young_delta_pct:   number
  // 複合ランキング 3軸加重
  weight_inflow_score:                number
  weight_transaction_count:           number
  weight_area_score:                  number
  // 名寄せ信頼度しきい値
  name_resolution_auto_threshold:     number
  name_resolution_review_threshold:   number
  updated_at:                         string
}

// ----------------------------------------------------------------------------
// API レスポンス型 (/api/towns/young-family-inflow)
// ----------------------------------------------------------------------------
export interface InflowRankingRow {
  town_id:                string
  town_name:              string
  city_name:              string
  oaza_name:              string
  chome_name:             string | null
  inflow_score:           number
  is_young_family_inflow: boolean
  population_delta_abs:   number
  population_delta_pct:   number
  households_delta_abs:   number
  family_index:           number
  young_family_delta_abs: number
  young_family_delta_pct: number
  base_year:              number
  target_year:            number
}

export interface InflowRankingResponse {
  city_id: string
  count:   number
  rows:    InflowRankingRow[]
}

// ----------------------------------------------------------------------------
// ソート / フィルタ ヘルパー型
// ----------------------------------------------------------------------------
export type InflowSortKey =
  | 'inflow_score'
  | 'population_delta_abs'
  | 'population_delta_pct'
  | 'family_index'
  | 'young_family_delta_pct'
  | 'young_family_delta_abs'

export interface InflowFilters {
  cityId?:     string
  cityName?:   string
  inflowOnly?: boolean
  sortBy?:     InflowSortKey
  sortDir?:    'asc' | 'desc'
  limit?:      number
  baseYear?:   number
  targetYear?: number
}

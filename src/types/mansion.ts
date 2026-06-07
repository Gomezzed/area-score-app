/**
 * ============================================================================
 *  src/types/mansion.ts
 *  マンションマスター / 取引履歴 / 名寄せ 型定義
 * ============================================================================
 */

export type MansionSource     = 'manual' | 'reins' | 'open_data' | 'estimated'
export type MansionConfidence = 'verified' | 'unverified'

export type Structure = 'RC' | 'SRC' | 'S' | 'W' | 'OTHER' | null

export interface MansionMaster {
  id:                string
  prefecture_code:   string                  // JIS 2桁
  city_code:         string                  // JIS 5桁
  town_id:           string | null
  name:              string
  normalized_name:   string
  address:           string | null
  town_name:         string
  chome:             string | null
  banchi:            string | null
  building_year:     number | null
  structure:         Structure
  total_units:       number | null
  total_floors:      number | null
  lat:               number | null
  lng:               number | null
  source:            MansionSource
  confidence:        MansionConfidence
  raw_payload:       Record<string, unknown> | null
  created_at:        string
  updated_at:        string
}

export type ResolutionStatus =
  | 'unresolved'
  | 'auto_matched'
  | 'requires_review'
  | 'manual'
  | 'unresolvable'
  | 'not_applicable'

export interface ResolutionCandidate {
  mansion_id:   string
  mansion_name: string
  score:        number
  breakdown: {
    address:       number
    building_year: number
    structure:     number
  }
}

export interface TradeHistory {
  id:                       string
  prefecture_code:          string
  city_code:                string
  city_name:                string
  town_name:                string | null
  chome:                    string | null
  traded_year:              number
  traded_quarter:           number
  traded_price:             number | null
  price_per_sqm:            number | null
  area_sqm:                 number | null
  layout:                   string | null
  building_year:            number | null
  structure:                Structure
  property_type:            string
  mansion_name_raw:         string | null
  mansion_id:               string | null
  mansion_name_resolved:    string | null
  resolution_status:        ResolutionStatus
  resolution_confidence:    number | null
  resolution_candidates:    ResolutionCandidate[] | null
  resolution_log:           Record<string, unknown> | null
  resolved_at:              string | null
  resolved_by:              string | null
  source:                   'reinfolib' | 'mlit_webland'
  raw_payload:              Record<string, unknown> | null
  created_at:               string
  updated_at:               string
}

/** v_mansion_with_trade_count ビュー戻り型 */
export interface MansionWithTradeCount {
  mansion_id:          string
  mansion_name:        string
  city_code:           string
  town_name:           string
  building_year:       number | null
  structure:           Structure
  total_units:         number | null
  lat:                 number | null
  lng:                 number | null
  trade_count:         number
  avg_price_per_sqm:   number | null
  latest_traded_year:  number | null
}

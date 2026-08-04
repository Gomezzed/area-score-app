// ============================================================
// 国勢調査ベース 新データ層の型定義
// ============================================================

export type Region =
  | 'hokkaido'
  | 'tohoku'
  | 'kanto'
  | 'tokai'
  | 'hokuriku'
  | 'kinki'
  | 'chugoku'
  | 'shikoku'
  | 'kyushu'
  | 'okinawa'

export interface Prefecture {
  code: string          // '01' .. '47'
  name: string          // '北海道'
  name_en: string       // 'hokkaido'
  region: Region
  center_lat: number | null
  center_lng: number | null
  zoom_level: number
}

export interface PopulationStat {
  id: string
  municipality_id: string
  year: number                          // 2015 | 2020 | 2025
  population: number | null
  households: number | null
  population_delta: number | null       // 前回からの増減数
  population_delta_rate: number | null  // 増減率（%）
}

export interface Municipality {
  id: string
  prefecture_code: string
  city_code: string | null
  name: string
  lat: number | null
  lng: number | null
  // 注: 人口推移グラフは population_stats（2015/2020/2025 の国勢調査実測）を源とする。
  //     旧 municipalities.population_history は参照しない（サンプル値が残存するため）。
  // その市区町村に属する駅の最新乗降客数の合計（国交省 XKT015）。未投入時は 0。
  station_passengers_total?: number | null
}

// 駅明細（国交省 不動産情報ライブラリ XKT015 / 駅別乗降客数）
export interface Station {
  id: string
  municipality_id: string | null
  prefecture_code: string | null
  station_code: string | null   // S12_001c（駅コード）
  group_code: string            // S12_001g（グループコード・重複排除キー）
  name: string                  // S12_001_ja（駅名）
  operator: string | null       // S12_002_ja（運営会社）
  line_name: string | null      // S12_003_ja（路線名）
  passengers_latest: number | null  // 最新乗降客数
  passengers_year: number | null    // 上記の年（例: 2023）
  lat: number | null
  lng: number | null
}

// 市区町村 + 国勢調査統計（最新=2025速報 / 前回=2020 / 2015）を平坦化したビューモデル
export interface MunicipalityWithStats extends Municipality {
  popLatest: number | null         // 2025（速報）人口
  popPrev: number | null           // 2020 人口（増減率の基準）
  popPrev2: number | null          // 2015 人口（詳細パネルの参考値）
  householdsLatest: number | null  // 2025（速報）世帯数
  delta: number | null             // 2020→2025 人口増減数
  deltaRate: number | null         // 2020→2025 人口増減率（%）
  stationPassengersTotal: number  // 駅乗降客数合計（最新）。未投入時は 0。
  // L-2(表示版): Free で上位3件超のロック対象行。実数値を null 化し id/name のみ保持。
  locked?: boolean
}

// 不動産取引（中古マンション等）：市区町村 × 年 × 四半期
export interface RealEstateTransaction {
  id: string
  municipality_id: string | null
  prefecture_code: string
  city_code: string
  year: number
  quarter: number
  transaction_count: number | null
  avg_price_man_yen: number | null   // 平均取引価格（万円）
  avg_price_per_sqm: number | null   // 平均㎡単価（万円/㎡）
  avg_area_sqm: number | null        // 平均面積（㎡）
}

// 年単位に集計した取引サマリ（四半期を統合）
export interface TransactionYearSummary {
  year: number
  count: number                  // 年間成約件数
  avgPriceManYen: number | null  // 加重平均 取引価格（万円）
  avgPricePerSqm: number | null  // 加重平均 ㎡単価（万円/㎡）
  avgAreaSqm: number | null      // 加重平均 面積（㎡）
}

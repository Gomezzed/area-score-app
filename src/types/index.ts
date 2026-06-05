// ============================================================
// 国勢調査ベース 新データ層の型定義
// ============================================================

export type Region =
  | 'hokkaido_tohoku'
  | 'kanto'
  | 'chubu'
  | 'kinki'
  | 'chugoku_shikoku'
  | 'kyushu_okinawa'

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
  year: number                          // 2015 | 2020
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
}

// 市区町村 + 2020/2015 国勢調査の統計を平坦化したビューモデル
export interface MunicipalityWithStats extends Municipality {
  pop2020: number | null
  pop2015: number | null
  households2020: number | null
  delta: number | null        // 2015→2020 人口増減数
  deltaRate: number | null    // 2015→2020 人口増減率（%）
}

// Static region → prefecture mapping.
// name_en must match cities.name_en in Supabase (or be the key we intend to use).

export interface PrefInfo {
  name: string    // 宮城
  name_en: string // sendai  ← matches cities.name_en
  lat: number
  lng: number
  zoom: number
}

export interface RegionDef {
  id: string
  name: string
  prefectures: PrefInfo[]
}

export const REGIONS: RegionDef[] = [
  {
    id: 'hokkaido_tohoku',
    name: '北海道・東北',
    prefectures: [
      { name: '北海道', name_en: 'hokkaido',  lat: 43.06, lng: 141.35, zoom: 7 },
      { name: '青森',   name_en: 'aomori',    lat: 40.82, lng: 140.74, zoom: 9 },
      { name: '岩手',   name_en: 'iwate',     lat: 39.70, lng: 141.15, zoom: 8 },
      { name: '宮城',   name_en: 'sendai',    lat: 38.27, lng: 140.87, zoom: 9 },
      { name: '秋田',   name_en: 'akita',     lat: 39.72, lng: 140.10, zoom: 9 },
      { name: '山形',   name_en: 'yamagata',  lat: 38.24, lng: 140.36, zoom: 9 },
      { name: '福島',   name_en: 'fukushima', lat: 37.75, lng: 140.47, zoom: 9 },
    ],
  },
  {
    id: 'kanto',
    name: '関東',
    prefectures: [
      { name: '東京',   name_en: 'tokyo',     lat: 35.69, lng: 139.69, zoom: 10 },
      { name: '神奈川', name_en: 'kanagawa',  lat: 35.45, lng: 139.64, zoom: 10 },
      { name: '埼玉',   name_en: 'saitama',   lat: 35.86, lng: 139.65, zoom: 10 },
      { name: '千葉',   name_en: 'chiba',     lat: 35.61, lng: 140.12, zoom: 9  },
      { name: '茨城',   name_en: 'ibaraki',   lat: 36.34, lng: 140.45, zoom: 9  },
      { name: '栃木',   name_en: 'tochigi',   lat: 36.57, lng: 139.88, zoom: 9  },
      { name: '群馬',   name_en: 'gunma',     lat: 36.39, lng: 139.06, zoom: 9  },
    ],
  },
  {
    id: 'chubu',
    name: '中部',
    prefectures: [
      { name: '愛知',   name_en: 'aichi',     lat: 35.18, lng: 136.91, zoom: 9 },
      { name: '静岡',   name_en: 'shizuoka',  lat: 34.98, lng: 138.38, zoom: 9 },
      { name: '岐阜',   name_en: 'gifu',      lat: 35.39, lng: 136.72, zoom: 9 },
      { name: '三重',   name_en: 'mie',       lat: 34.73, lng: 136.51, zoom: 9 },
      { name: '長野',   name_en: 'nagano',    lat: 36.65, lng: 138.18, zoom: 8 },
      { name: '新潟',   name_en: 'niigata',   lat: 37.90, lng: 139.02, zoom: 9 },
      { name: '富山',   name_en: 'toyama',    lat: 36.70, lng: 137.21, zoom: 9 },
      { name: '石川',   name_en: 'ishikawa',  lat: 36.59, lng: 136.63, zoom: 9 },
      { name: '福井',   name_en: 'fukui',     lat: 36.06, lng: 136.22, zoom: 9 },
      { name: '山梨',   name_en: 'yamanashi', lat: 35.66, lng: 138.57, zoom: 9 },
    ],
  },
  {
    id: 'kinki',
    name: '近畿',
    prefectures: [
      { name: '大阪',   name_en: 'osaka',     lat: 34.69, lng: 135.50, zoom: 10 },
      { name: '兵庫',   name_en: 'hyogo',     lat: 34.69, lng: 135.18, zoom: 9  },
      { name: '京都',   name_en: 'kyoto',     lat: 35.02, lng: 135.76, zoom: 10 },
      { name: '滋賀',   name_en: 'shiga',     lat: 35.00, lng: 135.87, zoom: 9  },
      { name: '奈良',   name_en: 'nara',      lat: 34.69, lng: 135.83, zoom: 10 },
      { name: '和歌山', name_en: 'wakayama',  lat: 34.23, lng: 135.17, zoom: 9  },
    ],
  },
  {
    id: 'chugoku_shikoku',
    name: '中国・四国',
    prefectures: [
      { name: '広島',   name_en: 'hiroshima',  lat: 34.40, lng: 132.46, zoom: 9  },
      { name: '岡山',   name_en: 'okayama',    lat: 34.66, lng: 133.93, zoom: 9  },
      { name: '山口',   name_en: 'yamaguchi',  lat: 34.19, lng: 131.47, zoom: 9  },
      { name: '鳥取',   name_en: 'tottori',    lat: 35.50, lng: 134.24, zoom: 9  },
      { name: '島根',   name_en: 'shimane',    lat: 35.47, lng: 133.05, zoom: 9  },
      { name: '愛媛',   name_en: 'ehime',      lat: 33.84, lng: 132.77, zoom: 9  },
      { name: '香川',   name_en: 'kagawa',     lat: 34.34, lng: 134.04, zoom: 10 },
      { name: '高知',   name_en: 'kochi',      lat: 33.56, lng: 133.53, zoom: 9  },
      { name: '徳島',   name_en: 'tokushima',  lat: 34.07, lng: 134.55, zoom: 9  },
    ],
  },
  {
    id: 'kyushu_okinawa',
    name: '九州・沖縄',
    prefectures: [
      { name: '福岡',   name_en: 'fukuoka',    lat: 33.59, lng: 130.42, zoom: 10 },
      { name: '鹿児島', name_en: 'kagoshima',  lat: 31.60, lng: 130.56, zoom: 10 },
      { name: '熊本',   name_en: 'kumamoto',   lat: 32.79, lng: 130.74, zoom: 9  },
      { name: '長崎',   name_en: 'nagasaki',   lat: 32.75, lng: 129.88, zoom: 9  },
      { name: '大分',   name_en: 'oita',       lat: 33.24, lng: 131.61, zoom: 9  },
      { name: '宮崎',   name_en: 'miyazaki',   lat: 31.91, lng: 131.42, zoom: 9  },
      { name: '佐賀',   name_en: 'saga',       lat: 33.25, lng: 130.30, zoom: 10 },
      { name: '沖縄',   name_en: 'okinawa',    lat: 26.21, lng: 127.68, zoom: 10 },
    ],
  },
]

/** Flat lookup: name_en → PrefInfo */
export const PREF_BY_NAME_EN: Record<string, PrefInfo> = Object.fromEntries(
  REGIONS.flatMap((r) => r.prefectures).map((p) => [p.name_en, p])
)

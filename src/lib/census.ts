import { Region } from '@/types'

// 地方区分（タブ表示順）。prefectures は地方タブ内の表示順（地理的順）。
export interface RegionDef {
  id: Region
  name: string
  prefectures: { code: string; name: string }[]
}

export const REGIONS: RegionDef[] = [
  {
    id: 'hokkaido',
    name: '北海道',
    prefectures: [
      { code: '01', name: '北海道' }
    ]
  },
  {
    id: 'tohoku',
    name: '東北',
    prefectures: [
      { code: '02', name: '青森県' },
      { code: '03', name: '岩手県' },
      { code: '05', name: '秋田県' },
      { code: '04', name: '宮城県' },
      { code: '06', name: '山形県' },
      { code: '07', name: '福島県' }
    ]
  },
  {
    id: 'kanto',
    name: '関東',
    prefectures: [
      { code: '08', name: '茨城県' },
      { code: '09', name: '栃木県' },
      { code: '10', name: '群馬県' },
      { code: '19', name: '山梨県' },
      { code: '20', name: '長野県' },
      { code: '11', name: '埼玉県' },
      { code: '12', name: '千葉県' },
      { code: '13', name: '東京都' },
      { code: '14', name: '神奈川県' }
    ]
  },
  {
    id: 'tokai',
    name: '東海',
    prefectures: [
      { code: '22', name: '静岡県' },
      { code: '21', name: '岐阜県' },
      { code: '23', name: '愛知県' },
      { code: '24', name: '三重県' }
    ]
  },
  {
    id: 'hokuriku',
    name: '北陸',
    prefectures: [
      { code: '15', name: '新潟県' },
      { code: '16', name: '富山県' },
      { code: '17', name: '石川県' },
      { code: '18', name: '福井県' }
    ]
  },
  {
    id: 'kinki',
    name: '近畿',
    prefectures: [
      { code: '25', name: '滋賀県' },
      { code: '26', name: '京都府' },
      { code: '29', name: '奈良県' },
      { code: '30', name: '和歌山県' },
      { code: '27', name: '大阪府' },
      { code: '28', name: '兵庫県' }
    ]
  },
  {
    id: 'chugoku',
    name: '中国',
    prefectures: [
      { code: '31', name: '鳥取県' },
      { code: '32', name: '島根県' },
      { code: '33', name: '岡山県' },
      { code: '34', name: '広島県' },
      { code: '35', name: '山口県' }
    ]
  },
  {
    id: 'shikoku',
    name: '四国',
    prefectures: [
      { code: '36', name: '徳島県' },
      { code: '37', name: '香川県' },
      { code: '38', name: '愛媛県' },
      { code: '39', name: '高知県' }
    ]
  },
  {
    id: 'kyushu',
    name: '九州',
    prefectures: [
      { code: '40', name: '福岡県' },
      { code: '41', name: '佐賀県' },
      { code: '42', name: '長崎県' },
      { code: '44', name: '大分県' },
      { code: '43', name: '熊本県' },
      { code: '45', name: '宮崎県' },
      { code: '46', name: '鹿児島県' }
    ]
  },
  {
    id: 'okinawa',
    name: '沖縄',
    prefectures: [
      { code: '47', name: '沖縄県' }
    ]
  }
]

// 人口増減率の色分け凡例（地図マーカー・リスト共通）
export interface DeltaBucket {
  label: string
  color: string
}

export const DELTA_BUCKETS: DeltaBucket[] = [
  { label: '+2%超', color: '#1e40af' },   // 濃い青
  { label: '0〜+2%', color: '#60a5fa' },   // 薄い青
  { label: '-1〜0%', color: '#9ca3af' },   // グレー
  { label: '-3〜-1%', color: '#f97316' },  // オレンジ
  { label: '-3%未満', color: '#ef4444' },  // 赤
]

const NO_DATA_COLOR = '#475569' // データなし（slate）

// 人口増減率 → マーカー色
export function deltaColor(rate: number | null | undefined): string {
  if (rate == null) return NO_DATA_COLOR
  if (rate > 2) return DELTA_BUCKETS[0].color
  if (rate >= 0) return DELTA_BUCKETS[1].color
  if (rate >= -1) return DELTA_BUCKETS[2].color
  if (rate >= -3) return DELTA_BUCKETS[3].color
  return DELTA_BUCKETS[4].color
}

// 人口（実数）→ 「197.3万人」/「2,929人」
export function formatPopulation(pop: number | null | undefined): string {
  if (pop == null) return '—'
  if (pop >= 10000) return `${(pop / 10000).toFixed(1)}万人`
  return `${pop.toLocaleString('ja-JP')}人`
}

// 人口増減数 → 「+1,234人」/「-567人」
export function formatDelta(delta: number | null | undefined): string {
  if (delta == null) return '—'
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toLocaleString('ja-JP')}人`
}

// 人口増減率 → 「1.08」（符号・矢印は呼び出し側で付与）
export function formatRate(rate: number | null | undefined): string {
  if (rate == null) return '—'
  const sign = rate > 0 ? '+' : ''
  return `${sign}${rate.toFixed(2)}%`
}

// 政令指定都市の行政区名を「市」「区」に分解する
//   '名古屋市西区'   → { city: '名古屋市', ward: '西区' }
//   '横浜市鶴見区'   → { city: '横浜市',   ward: '鶴見区' }
//   '千代田区'(特別区) → null（「市」接頭辞を持たないため対象外）
//   '名古屋市'(市本体) → null（区で終わらないため対象外）
const WARD_RE = /^(.+?市)(.+区)$/
export function parseWard(name: string): { city: string; ward: string } | null {
  const m = name.match(WARD_RE)
  return m ? { city: m[1], ward: m[2] } : null
}

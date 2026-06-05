import { Region } from '@/types'

// 地方区分（タブ表示順）
export const REGIONS: { key: Region; label: string }[] = [
  { key: 'hokkaido_tohoku', label: '北海道・東北' },
  { key: 'kanto', label: '関東' },
  { key: 'chubu', label: '中部' },
  { key: 'kinki', label: '近畿' },
  { key: 'chugoku_shikoku', label: '中国・四国' },
  { key: 'kyushu_okinawa', label: '九州・沖縄' },
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

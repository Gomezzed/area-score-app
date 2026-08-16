// =====================================================================
// M2-0 / SD-27・SD-29・SD-36: 学区図オーバーレイのクライアント側ユーティリティ。
//   - 取得は /api/school-districts 経由（サーバークライアントで RLS 適用・未認証401）。
//   - 「選択中の市区町村×校種」単位のオンデマンド取得。同一キーは再フェッチしない
//     （セッション内メモリキャッシュ。localStorage 等は使わない）。
// =====================================================================

export const SCHOOL_TYPES = ['elementary', 'junior_high'] as const
export type SchoolType = (typeof SCHOOL_TYPES)[number]

export const SCHOOL_TYPE_LABELS: Record<SchoolType, string> = {
  elementary: '小学校区',
  junior_high: '中学校区',
}

// 既定＝小学校区（SD-27）。
export const DEFAULT_SCHOOL_TYPE: SchoolType = 'elementary'

export function isSchoolType(v: unknown): v is SchoolType {
  return v === 'elementary' || v === 'junior_high'
}

// 免責（学区図ON中、地図フッターに常時表示。折りたたみ・ホバー格納は禁止）。一言一句固定・O27。
export const SCHOOL_DISTRICT_DISCLAIMER =
  '通学区域は変更される場合があり、番地単位で境界と異なることがあります。実際の指定校は各市区町村の教育委員会にご確認ください。'

// 未公開市の文言（SD-27・一言一句固定）。
export const SCHOOL_DISTRICT_UNAVAILABLE = 'この市区町村の学区図は現在提供していません'

export interface SchoolDistrictFeature {
  type: 'Feature'
  geometry: unknown
  properties: {
    school_name: string
    school_type: string
    muni_code_5: string
    attribution_text: string | null
    label_lng: number
    label_lat: number
  }
}

export interface SchoolDistrictFeatureCollection {
  type: 'FeatureCollection'
  features: SchoolDistrictFeature[]
}

const EMPTY_FC: SchoolDistrictFeatureCollection = { type: 'FeatureCollection', features: [] }

// (muni_code_5, school_type) の公開ペア。トグルの disabled 前置判定に使う（D1案(c)）。
export function availabilityKey(muniCode5: string, type: SchoolType): string {
  return `${muniCode5}:${type}`
}

// ── セッション内メモリキャッシュ ──
const geojsonCache = new Map<string, SchoolDistrictFeatureCollection>()
let availabilityCache: Set<string> | null = null
let availabilityInflight: Promise<Set<string>> | null = null

// 公開されている (muni_code_5, school_type) 一覧をセッション1回だけ取得。
// RLS が is_public=true 行のみに絞るため、8市ハードコード不要。
export async function fetchAvailability(): Promise<Set<string>> {
  if (availabilityCache) return availabilityCache
  if (availabilityInflight) return availabilityInflight
  availabilityInflight = (async () => {
    const res = await fetch('/api/school-districts?availability=1')
    if (!res.ok) throw new Error(`availability fetch failed: ${res.status}`)
    const json = (await res.json()) as { pairs?: Array<{ muni_code_5: string; school_type: string }> }
    const set = new Set<string>((json.pairs ?? []).map((p) => `${p.muni_code_5}:${p.school_type}`))
    availabilityCache = set
    return set
  })()
  try {
    return await availabilityInflight
  } finally {
    // 失敗時は次回再試行できるよう inflight を解放（成功時は availabilityCache が効く）。
    if (!availabilityCache) availabilityInflight = null
  }
}

// 選択中の市区町村×校種のポリゴンを取得（メモリキャッシュ・再フェッチしない）。
export async function fetchDistricts(
  muniCode5: string,
  type: SchoolType,
): Promise<SchoolDistrictFeatureCollection> {
  const key = availabilityKey(muniCode5, type)
  const cached = geojsonCache.get(key)
  if (cached) return cached
  const qs = `muni_code_5=${encodeURIComponent(muniCode5)}&school_type=${encodeURIComponent(type)}`
  const res = await fetch(`/api/school-districts?${qs}`)
  if (!res.ok) throw new Error(`districts fetch failed: ${res.status}`)
  const json = (await res.json()) as SchoolDistrictFeatureCollection
  const fc = json && Array.isArray(json.features) ? json : EMPTY_FC
  geojsonCache.set(key, fc)
  return fc
}

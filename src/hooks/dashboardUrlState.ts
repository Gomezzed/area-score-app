// ダッシュボード URL 状態の「純ロジック」だけを集めたモジュール。
//   React / next / Supabase に依存しないため、Node 標準テストランナーで単体検証できる。
//   型は import type（実行時に消去）のみ。フック本体は useDashboardUrlState.ts。
import type { Prefecture, MunicipalityWithStats } from '@/types'

// 既定の都道府県コード（北海道＝REGIONS[0] の先頭県）。未知/欠落 pref のフォールバック先。
export const DEFAULT_PREF_CODE = '01'
// city_code は全 municipalities が5桁（偵察レポート §5 実測）。5桁でない値は無視する。
const CITY_CODE_RE = /^\d{5}$/

// pref/city/area から /dashboard の URL を組み立てる（順序を固定して比較を安定化）。
export function buildDashboardUrl(
  pathname: string,
  prefName: string | null,
  cityCode: string | null,
  areaCode: string | null,
): string {
  const params = new URLSearchParams()
  if (prefName) params.set('pref', prefName)
  if (cityCode) params.set('city', cityCode)
  if (areaCode) params.set('area', areaCode)
  const qs = params.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

// pref（name_en）→ 都道府県。未知 name_en・欠落は北海道（先頭県）へフォールバック。
//   prefectures 未ロード時は undefined（呼び出し側はロード完了まで待つ）。
export function resolveActivePref(
  rawPref: string | null,
  prefectures: Prefecture[],
): Prefecture | undefined {
  if (prefectures.length === 0) return undefined
  if (rawPref) {
    const found = prefectures.find((p) => p.name_en === rawPref)
    if (found) return found
  }
  return prefectures.find((p) => p.code === DEFAULT_PREF_CODE) ?? prefectures[0]
}

// city（5桁コード）→ ドリルダウン中の政令市名。5桁外/未知/非政令市（区を持たない）は null。
export function resolveExpandedCity(
  rawCity: string | null,
  municipalities: MunicipalityWithStats[],
  designatedNames: Set<string>,
): string | null {
  if (!rawCity || !CITY_CODE_RE.test(rawCity)) return null
  const m = municipalities.find((x) => x.city_code === rawCity)
  if (!m || !designatedNames.has(m.name)) return null
  return m.name
}

// area（5桁コード）→ 選択中の市区町村/区。5桁外/未知は null（詳細パネルは落ちない）。
export function resolveSelectedArea(
  rawArea: string | null,
  municipalities: MunicipalityWithStats[],
): MunicipalityWithStats | null {
  if (!rawArea || !CITY_CODE_RE.test(rawArea)) return null
  return municipalities.find((x) => x.city_code === rawArea) ?? null
}

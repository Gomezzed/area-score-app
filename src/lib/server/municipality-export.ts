import { createSupabaseServerClient } from '@/lib/supabase-server'
import { CENSUS, parseWard } from '@/lib/census'
import type { MunicipalityWithStats } from '@/types'

// ============================================================
// エクスポート用に、指定都道府県の市区町村ビューモデルを
// サーバー側で再取得する。クライアントから渡されたデータは一切使わない。
//
//   ロジックは useMunicipalities（src/hooks/useCensus.ts）＋ダッシュボードの
//   topLevel（区の除外）を server 側で忠実に再現し、CSV/画面と同一の
//   「行・列・並び」を保証する。
//     1. prefecture_name_en を prefectures テーブルで検証（不正値は 400）
//     2. municipalities + population_stats を取得し CENSUS 年で平坦化
//     3. 人口（最新）降順にソート
//     4. 政令市の区（親「市」が同一県内に存在）を除外
// ============================================================

type SupabaseServer = Awaited<ReturnType<typeof createSupabaseServerClient>>

interface PopulationStatRow {
  year: number
  population: number | null
  households: number | null
  population_delta: number | null
  population_delta_rate: number | null
}

interface MuniRow {
  id: string
  prefecture_code: string
  city_code: string | null
  name: string
  lat: number | null
  lng: number | null
  station_passengers_total: number | null
  population_stats: PopulationStatRow[] | null
}

export interface MunicipalityExportData {
  prefectureName: string
  prefectureNameEn: string
  municipalities: MunicipalityWithStats[]
}

export type MunicipalityExportResult =
  | { ok: true; data: MunicipalityExportData }
  | { ok: false; status: number; error: string }

export async function fetchMunicipalityExportData(
  supabase: SupabaseServer,
  prefectureNameEnInput: unknown,
): Promise<MunicipalityExportResult> {
  // ── 入力検証（型・空文字） ──
  if (
    typeof prefectureNameEnInput !== 'string' ||
    prefectureNameEnInput.trim() === ''
  ) {
    return { ok: false, status: 400, error: 'prefecture_name_en が必要です' }
  }
  const nameEn = prefectureNameEnInput.trim()

  // ── 既知の都道府県名（name_en）に対して検証。不正値は 400 ──
  const { data: pref, error: prefErr } = await supabase
    .from('prefectures')
    .select('code, name, name_en')
    .eq('name_en', nameEn)
    .maybeSingle()

  if (prefErr) {
    return { ok: false, status: 500, error: '都道府県の取得に失敗しました' }
  }
  if (!pref) {
    return { ok: false, status: 400, error: '不正な prefecture_name_en です' }
  }

  // ── 市区町村 + 国勢調査統計（2025速報 / 2020 / 2015） ──
  const { data, error } = await supabase
    .from('municipalities')
    .select(
      'id, prefecture_code, city_code, name, lat, lng, station_passengers_total, population_stats(year, population, households, population_delta, population_delta_rate)',
    )
    .eq('prefecture_code', pref.code)

  if (error) {
    return { ok: false, status: 500, error: '市区町村の取得に失敗しました' }
  }

  const rows = (data ?? []) as unknown as MuniRow[]
  const flattened: MunicipalityWithStats[] = rows.map((m) => {
    const sLatest = m.population_stats?.find((s) => s.year === CENSUS.latest)
    const sPrev = m.population_stats?.find((s) => s.year === CENSUS.prev)
    const sPrev2 = m.population_stats?.find((s) => s.year === CENSUS.prev2)
    return {
      id: m.id,
      prefecture_code: m.prefecture_code,
      city_code: m.city_code,
      name: m.name,
      lat: m.lat,
      lng: m.lng,
      popLatest: sLatest?.population ?? null,
      popPrev: sPrev?.population ?? null,
      popPrev2: sPrev2?.population ?? null,
      householdsLatest: sLatest?.households ?? null,
      delta: sLatest?.population_delta ?? null,
      deltaRate: sLatest?.population_delta_rate ?? null,
      stationPassengersTotal: m.station_passengers_total ?? 0,
    }
  })

  // 人口（最新=2025）降順（useMunicipalities と同一）
  flattened.sort((a, b) => (b.popLatest ?? -1) - (a.popLatest ?? -1))

  // トップレベル（区を除く）: 親「市」が同一県内に存在する区のみを行政区として除外
  //   （ダッシュボードの isWard / topLevel と同一）。
  const cityNames = new Set(flattened.map((m) => m.name))
  const topLevel = flattened.filter((m) => {
    const w = parseWard(m.name)
    return !(w && cityNames.has(w.city))
  })

  return {
    ok: true,
    data: {
      prefectureName: pref.name as string,
      prefectureNameEn: pref.name_en as string,
      municipalities: topLevel,
    },
  }
}

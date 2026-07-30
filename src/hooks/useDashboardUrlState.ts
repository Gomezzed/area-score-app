'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useMunicipalities } from '@/hooks/useCensus'
import { REGIONS, parseWard } from '@/lib/census'
import { Prefecture, MunicipalityWithStats, Region } from '@/types'
import {
  buildDashboardUrl,
  resolveActivePref,
  resolveExpandedCity,
  resolveSelectedArea,
} from '@/hooks/dashboardUrlState'

// ダッシュボードの表示状態を URL クエリに載せて単一の情報源にするフック。
//   /dashboard?pref={name_en}&city={5桁city_code}&area={5桁city_code}
//   - pref : 都道府県 name_en（地方タブ region は pref から導出し、URL には載せない）
//   - city : 政令市ドリル中の「政令市本体」の city_code（区一覧を開いているときのみ）
//   - area : 詳細パネルで選択中の市区町村/区の city_code
//   検索文字列等の非 URL 状態は呼び出し側の useState 継続でよい。
//
// 原則2（コードを背骨に）: area/city のキーは city_code（5桁）で持ち、名称や name_en を
// キーにしない。名称⇄コードの対応はロード済みデータ（prefectures / municipalities）で解決する。
// URL 組み立て・pref/city/area 解決の純ロジックは dashboardUrlState.ts（テスト対象）に分離。

// 都道府県コード → 地方タブ。REGIONS 構造から導出し、DB の region 列ドリフトに依存しない。
function regionOf(code: string | undefined): Region {
  if (code) {
    const def = REGIONS.find((r) => r.prefectures.some((p) => p.code === code))
    if (def) return def.id
  }
  return REGIONS[0].id
}

export function useDashboardUrlState(prefectures: Prefecture[]) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const rawPref = searchParams.get('pref')
  const rawCity = searchParams.get('city')
  const rawArea = searchParams.get('area')

  // ── pref 解決（未知 name_en・欠落は北海道へフォールバック） ──
  const activePref = useMemo(() => resolveActivePref(rawPref, prefectures), [rawPref, prefectures])

  const region = useMemo(() => regionOf(activePref?.code), [activePref])

  // 地方タブ内の都道府県（REGIONS の地理的表示順）
  const regionPrefs = useMemo(() => {
    const def = REGIONS.find((r) => r.id === region)
    if (!def) return []
    const byCode = new Map(prefectures.map((p) => [p.code, p]))
    return def.prefectures
      .map((p) => byCode.get(p.code))
      .filter((p): p is Prefecture => p != null)
  }, [prefectures, region])

  // 市区町村＋人口統計の取得（取得方式は既存フックのまま。本 PR では変更しない）
  const { municipalities, loading: muniLoading } = useMunicipalities(activePref?.code ?? '')

  // ── 政令指定都市（区）の階層構造を名称から導出 ──
  const cityNames = useMemo(() => new Set(municipalities.map((m) => m.name)), [municipalities])
  // 区を持つ政令市の名称集合（親「市」本体が同一都道府県内に存在する区のみ対象）
  const designatedNames = useMemo(() => {
    const s = new Set<string>()
    for (const m of municipalities) {
      const w = parseWard(m.name)
      if (w && cityNames.has(w.city)) s.add(w.city)
    }
    return s
  }, [municipalities, cityNames])
  // トップレベル（行政区を除く市区町村・政令市本体を含む）
  const topLevel = useMemo(
    () =>
      municipalities.filter((m) => {
        const w = parseWard(m.name)
        return !(w && cityNames.has(w.city))
      }),
    [municipalities, cityNames],
  )

  // ── city（5桁コード）→ ドリルダウン中の政令市名。未知/非政令市/5桁外は無視 ──
  const expandedCity = useMemo(
    () => resolveExpandedCity(rawCity, municipalities, designatedNames),
    [rawCity, municipalities, designatedNames],
  )

  // ── area（5桁コード）→ 選択中の市区町村/区。未知/5桁外は無視（詳細パネルは落ちない） ──
  const selected = useMemo(
    () => resolveSelectedArea(rawArea, municipalities),
    [rawArea, municipalities],
  )

  // トップレベル一覧 or 政令市ドリルダウン中はその区一覧
  const displayed = useMemo(() => {
    if (!expandedCity) return topLevel
    return municipalities.filter((m) => {
      const w = parseWard(m.name)
      return w && w.city === expandedCity
    })
  }, [expandedCity, topLevel, municipalities])

  // ── アクション ──
  // ドリル操作（pref 変更・政令市ドリル in/out・エリア選択）は push（履歴を積む）。
  // 選択解除（× / トグルオフ）・不正値の補正は replace（履歴を積まない）。

  // 都道府県選択: pref を差し替え、city / area は削除。
  const selectPref = useCallback(
    (code: string) => {
      const p = prefectures.find((x) => x.code === code)
      if (!p) return
      router.push(buildDashboardUrl(pathname, p.name_en, null, null), { scroll: false })
    },
    [prefectures, router, pathname],
  )

  // 地方タブ選択: その地方の先頭都道府県へ（pref 選択に集約）。
  const selectRegion = useCallback(
    (regionId: Region) => {
      const def = REGIONS.find((r) => r.id === regionId)
      if (!def) return
      selectPref(def.prefectures[0].code)
    },
    [selectPref],
  )

  // 政令市ドリルイン: city をその政令市本体の city_code に、area は削除。
  const enterCity = useCallback(
    (m: MunicipalityWithStats) => {
      if (!activePref || !m.city_code) return
      router.push(buildDashboardUrl(pathname, activePref.name_en, m.city_code, null), {
        scroll: false,
      })
    },
    [activePref, router, pathname],
  )

  // 区一覧から出る（戻る）: city / area を削除。in/out ともドリル操作として push。
  const exitCity = useCallback(() => {
    if (!activePref) return
    router.push(buildDashboardUrl(pathname, activePref.name_en, null, null), { scroll: false })
  }, [activePref, router, pathname])

  // 詳細パネルの選択解除（× / トグルオフ）: area のみ削除、city は維持。replace。
  const closeArea = useCallback(() => {
    if (!activePref) {
      router.replace(pathname, { scroll: false })
      return
    }
    const keepCity = expandedCity ? rawCity : null
    router.replace(buildDashboardUrl(pathname, activePref.name_en, keepCity, null), {
      scroll: false,
    })
  }, [activePref, expandedCity, rawCity, router, pathname])

  // 市区町村/区の選択: area を設定（ドリル中は city 維持）。同一項目の再クリックは解除。
  const selectArea = useCallback(
    (m: MunicipalityWithStats) => {
      if (!activePref) return
      if (selected?.id === m.id) {
        closeArea()
        return
      }
      if (!m.city_code) return
      const keepCity = expandedCity ? rawCity : null
      router.push(buildDashboardUrl(pathname, activePref.name_en, keepCity, m.city_code), {
        scroll: false,
      })
    },
    [activePref, selected, closeArea, expandedCity, rawCity, router, pathname],
  )

  // リスト/地図クリックの振り分け: トップレベルの政令市はドリルイン、他は選択。
  const handleSelect = useCallback(
    (m: MunicipalityWithStats) => {
      if (!expandedCity && designatedNames.has(m.name)) {
        enterCity(m)
        return
      }
      selectArea(m)
    },
    [expandedCity, designatedNames, enterCity, selectArea],
  )

  // ── URL 正規化: 不正 pref・孤立/不正な city/area を replace で除去 ──
  //   データ確定後のみ判定し、ロード中は誤って有効値を消さない。
  useEffect(() => {
    if (prefectures.length === 0) return
    const prefInvalid = rawPref != null && !prefectures.some((p) => p.name_en === rawPref)

    let desiredPref: string | null
    let desiredCity: string | null
    let desiredArea: string | null

    if (prefInvalid) {
      // 未知 pref は完全に既定へリセット（孤立する city/area も落とす）。
      desiredPref = null
      desiredCity = null
      desiredArea = null
    } else {
      desiredPref = rawPref ?? null
      if (muniLoading || municipalities.length === 0) {
        // 市区町村データ未確定時は city/area を触らない（誤除去防止）。
        desiredCity = rawCity ?? null
        desiredArea = rawArea ?? null
      } else {
        // 解決済み（expandedCity / selected）に一致するコードのみ残す。
        desiredCity = expandedCity ? rawCity : null
        desiredArea = selected ? rawArea : null
      }
    }

    const same = (a: string | null, b: string | null) => (a ?? null) === (b ?? null)
    if (same(desiredPref, rawPref) && same(desiredCity, rawCity) && same(desiredArea, rawArea)) {
      return
    }
    router.replace(buildDashboardUrl(pathname, desiredPref, desiredCity, desiredArea), {
      scroll: false,
    })
  }, [
    rawPref,
    rawCity,
    rawArea,
    prefectures,
    municipalities,
    muniLoading,
    expandedCity,
    selected,
    router,
    pathname,
  ])

  return {
    // 派生表示状態
    region,
    regionPrefs,
    activePref,
    municipalities,
    muniLoading,
    designatedNames,
    topLevel,
    displayed,
    expandedCity,
    selected,
    // アクション
    selectPref,
    selectRegion,
    enterCity,
    exitCity,
    selectArea,
    closeArea,
    handleSelect,
  }
}

'use client'

import dynamic from 'next/dynamic'
import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { usePrefectures, useMunicipalities } from '@/hooks/useCensus'
import { REGIONS, parseWard } from '@/lib/census'
import { PrefectureDropdown } from '@/components/ui/PrefectureDropdown'
import { MunicipalityList } from '@/components/ui/MunicipalityList'
import { MunicipalityDetailPanel } from '@/components/ui/MunicipalityDetailPanel'
import { generateMunicipalityCSV, downloadCSV } from '@/lib/csv'
import { Region, MunicipalityWithStats } from '@/types'
import { MapPin, LogOut, Download, RefreshCw, HelpCircle } from 'lucide-react'

// Leaflet は SSR 不可のため dynamic import
const MunicipalityMap = dynamic(
  () => import('@/components/map/MunicipalityMap').then((m) => m.MunicipalityMap),
  { ssr: false, loading: () => <div className="w-full h-full bg-slate-700 animate-pulse rounded-lg" /> },
)

export default function DashboardPage() {
  const router = useRouter()
  const { prefectures, loading: prefLoading } = usePrefectures()

  const [region, setRegion] = useState<Region>('hokkaido_tohoku')
  const [selectedPrefCode, setSelectedPrefCode] = useState<string>('')
  const [selected, setSelected] = useState<MunicipalityWithStats | null>(null)
  // ドリルダウン中の政令指定都市（区一覧を表示）。null のときは市区町村トップレベル。
  const [expandedCity, setExpandedCity] = useState<string | null>(null)

  // リージョン内の都道府県（コード順）
  const regionPrefs = useMemo(
    () => prefectures.filter((p) => p.region === region),
    [prefectures, region],
  )

  // リージョン切替時は先頭の都道府県をデフォルト選択
  useEffect(() => {
    if (regionPrefs.length === 0) return
    if (!regionPrefs.some((p) => p.code === selectedPrefCode)) {
      setSelectedPrefCode(regionPrefs[0].code)
      setSelected(null)
      setExpandedCity(null)
    }
  }, [regionPrefs, selectedPrefCode])

  const activePref = prefectures.find((p) => p.code === selectedPrefCode) ?? regionPrefs[0]
  const { municipalities, loading: muniLoading } = useMunicipalities(activePref?.code ?? '')

  // ── 政令指定都市（区）の階層構造を名称から導出 ──
  const cityNames = useMemo(() => new Set(municipalities.map((m) => m.name)), [municipalities])
  // 「市」本体が同一都道府県内に存在する区のみを行政区として扱う
  const isWard = useMemo(
    () => (m: MunicipalityWithStats) => {
      const w = parseWard(m.name)
      return !!(w && cityNames.has(w.city))
    },
    [cityNames],
  )
  // 区を持つ政令市の名称集合（リストで展開シェブロンを表示する対象）
  const designatedNames = useMemo(() => {
    const s = new Set<string>()
    for (const m of municipalities) {
      const w = parseWard(m.name)
      if (w && cityNames.has(w.city)) s.add(w.city)
    }
    return s
  }, [municipalities, cityNames])

  // トップレベル（区を除く）／ 指定都市ドリルダウン時はその区一覧
  const topLevel = useMemo(
    () => municipalities.filter((m) => !isWard(m)),
    [municipalities, isWard],
  )
  const displayed = useMemo(() => {
    if (!expandedCity) return topLevel
    return municipalities.filter((m) => {
      const w = parseWard(m.name)
      return w && w.city === expandedCity
    })
  }, [expandedCity, topLevel, municipalities])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  function handleCSVDownload() {
    if (!activePref || topLevel.length === 0) return
    // 政令市の行政区（区）は二重計上を避けるためトップレベル（市区町村）のみ出力
    const csv = generateMunicipalityCSV(topLevel, activePref)
    const date = new Date().toISOString().split('T')[0]
    downloadCSV(csv, `population-${activePref.name_en}-${date}.csv`)
  }

  // リスト項目クリック: 区を持つ政令市（トップレベル）はドリルダウン、それ以外は選択
  function handleSelect(m: MunicipalityWithStats) {
    if (!expandedCity && designatedNames.has(m.name)) {
      setExpandedCity(m.name)
      setSelected(null)
      return
    }
    setSelected((prev) => (prev?.id === m.id ? null : m))
  }

  function handleBack() {
    setExpandedCity(null)
    setSelected(null)
  }

  function handlePrefSelect(code: string) {
    setSelectedPrefCode(code)
    setSelected(null)
    setExpandedCity(null)
  }

  if (prefLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-slate-400 flex items-center gap-3 text-sm">
          <RefreshCw className="w-5 h-5 animate-spin" />
          読み込み中...
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-slate-900 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 flex-shrink-0">
        {/* Row 1: logo + actions */}
        <div className="px-3 sm:px-5 py-2 sm:py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <MapPin className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-white font-bold text-base sm:text-lg truncate">エリア人口分析</h1>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            <button
              onClick={handleCSVDownload}
              disabled={municipalities.length === 0}
              className="flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 min-w-[44px] sm:min-w-0 px-2 sm:px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
              title="CSV出力"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">CSV出力</span>
            </button>
            <Link
              href="/help"
              className="flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 min-w-[44px] sm:min-w-0 px-2 sm:px-3 py-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg text-sm transition-colors"
              title="使い方ガイド"
            >
              <HelpCircle className="w-4 h-4" />
              <span className="hidden sm:inline">ヘルプ</span>
            </Link>
            <button
              onClick={handleLogout}
              className="flex items-center justify-center min-h-[44px] sm:min-h-0 min-w-[44px] sm:min-w-0 px-2 sm:px-3 py-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg text-sm transition-colors"
              title="ログアウト"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Row 2: region tabs + prefecture dropdown */}
        <div className="px-3 pb-2 sm:pb-2.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <div
            className="flex gap-1 overflow-x-auto -mx-1 px-1 sm:mx-0 sm:px-0"
            style={{ scrollbarWidth: 'none' }}
          >
            {REGIONS.map((r) => (
              <button
                key={r.key}
                onClick={() => setRegion(r.key)}
                className={`px-4 min-h-[44px] sm:min-h-0 sm:py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
                  r.key === region
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="flex-shrink-0 w-full sm:w-auto">
            <PrefectureDropdown
              prefectures={regionPrefs}
              selectedCode={selectedPrefCode}
              onSelect={handlePrefSelect}
            />
          </div>
        </div>
      </header>

      {/* Stats bar */}
      <div className="bg-slate-800/60 border-b border-slate-700 px-3 sm:px-5 py-2 flex items-center gap-4 sm:gap-6 flex-shrink-0">
        <span className="text-xs sm:text-xs text-slate-500 truncate">
          {activePref?.name ?? '—'} ｜ 全{topLevel.length}市区町村（2020年国勢調査）
        </span>
        {muniLoading && (
          <span className="text-xs text-slate-500 flex items-center gap-1 flex-shrink-0">
            <RefreshCw className="w-3 h-3 animate-spin" /> 更新中
          </span>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 relative overflow-hidden">
        {/* List + Map（モバイル: 縦積み / デスクトップ: 横並び） */}
        <div className="absolute inset-0 flex flex-col md:flex-row">
          {/* Left: municipality list（モバイルは全幅・上段） */}
          <aside className="w-full md:w-72 flex-shrink-0 h-[42%] md:h-full border-b md:border-b-0 md:border-r border-slate-700 overflow-hidden">
            <MunicipalityList
              municipalities={displayed}
              selectedId={selected?.id ?? null}
              onSelect={handleSelect}
              expandableNames={designatedNames}
              drilldownCity={expandedCity}
              onBack={handleBack}
            />
          </aside>

          {/* Map（残りの高さ） */}
          <div className="flex-1 relative overflow-hidden">
            {activePref && (
              <MunicipalityMap
                prefecture={activePref}
                municipalities={displayed}
                selectedId={selected?.id ?? null}
                onSelect={handleSelect}
              />
            )}
          </div>
        </div>

        {/* Detail panel: モバイルは全画面オーバーレイ / デスクトップは右サイドパネル */}
        <MunicipalityDetailPanel municipality={selected} onClose={() => setSelected(null)} />
      </div>
    </div>
  )
}

'use client'

import dynamic from 'next/dynamic'
import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { usePrefectures, useMunicipalities } from '@/hooks/useCensus'
import { REGIONS } from '@/lib/census'
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
    }
  }, [regionPrefs, selectedPrefCode])

  const activePref = prefectures.find((p) => p.code === selectedPrefCode) ?? regionPrefs[0]
  const { municipalities, loading: muniLoading } = useMunicipalities(activePref?.code ?? '')

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  function handleCSVDownload() {
    if (!activePref || municipalities.length === 0) return
    const csv = generateMunicipalityCSV(municipalities, activePref)
    const date = new Date().toISOString().split('T')[0]
    downloadCSV(csv, `population-${activePref.name_en}-${date}.csv`)
  }

  function handleSelect(m: MunicipalityWithStats) {
    setSelected((prev) => (prev?.id === m.id ? null : m))
  }

  if (prefLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-slate-400 flex items-center gap-3">
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
        <div className="px-5 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <MapPin className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-white font-bold text-lg">エリア人口分析</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCSVDownload}
              disabled={municipalities.length === 0}
              className="flex items-center gap-2 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Download className="w-4 h-4" />
              CSV出力
            </button>
            <Link
              href="/help"
              className="flex items-center gap-2 px-3 py-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg text-sm transition-colors"
              title="使い方ガイド"
            >
              <HelpCircle className="w-4 h-4" />
              <span className="hidden sm:inline">ヘルプ</span>
            </Link>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg text-sm transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Row 2: region tabs + prefecture dropdown */}
        <div className="px-3 pb-2.5 flex items-center gap-3">
          <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {REGIONS.map((r) => (
              <button
                key={r.key}
                onClick={() => setRegion(r.key)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  r.key === region
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="flex-shrink-0">
            <PrefectureDropdown
              prefectures={regionPrefs}
              selectedCode={selectedPrefCode}
              onSelect={(code) => {
                setSelectedPrefCode(code)
                setSelected(null)
              }}
            />
          </div>
        </div>
      </header>

      {/* Stats bar */}
      <div className="bg-slate-800/60 border-b border-slate-700 px-5 py-2 flex items-center gap-6 flex-shrink-0">
        <span className="text-xs text-slate-500">
          {activePref?.name ?? '—'} ｜ 全{municipalities.length}市区町村（2020年国勢調査）
        </span>
        {muniLoading && (
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <RefreshCw className="w-3 h-3 animate-spin" /> 更新中
          </span>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: municipality list */}
        <aside className="w-72 flex-shrink-0 border-r border-slate-700 overflow-hidden">
          <MunicipalityList
            municipalities={municipalities}
            selectedId={selected?.id ?? null}
            onSelect={handleSelect}
          />
        </aside>

        {/* Map */}
        <div className="flex-1 relative overflow-hidden">
          {activePref && (
            <MunicipalityMap
              prefecture={activePref}
              municipalities={municipalities}
              selectedId={selected?.id ?? null}
              onSelect={handleSelect}
            />
          )}
          <MunicipalityDetailPanel municipality={selected} onClose={() => setSelected(null)} />
        </div>
      </div>
    </div>
  )
}

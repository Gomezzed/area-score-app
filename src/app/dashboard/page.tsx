'use client'

import dynamic from 'next/dynamic'
import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCities, useAreas } from '@/hooks/useAreas'
import { AreaList } from '@/components/ui/AreaList'
import { AreaDetailPanel } from '@/components/ui/AreaDetailPanel'
import { Area, City, DashboardFilters } from '@/types'
import { REGIONS, PREF_BY_NAME_EN, type PrefInfo } from '@/lib/regions'
import { generateCSV, downloadCSV } from '@/lib/csv'
import Link from 'next/link'
import { MapPin, LogOut, Download, RefreshCw, HelpCircle } from 'lucide-react'

const AreaMap = dynamic(
  () => import('@/components/map/AreaMap').then((m) => m.AreaMap),
  { ssr: false, loading: () => <div className="w-full h-full bg-slate-700 animate-pulse rounded-lg" /> }
)

/** Virtual City object built from PrefInfo when no DB city exists */
function prefToVirtualCity(pref: PrefInfo): City {
  return {
    id: `virtual-${pref.name_en}`,
    name: pref.name,
    name_en: pref.name_en,
    center_lat: pref.lat,
    center_lng: pref.lng,
    zoom_level: pref.zoom,
    created_at: '',
  }
}

export default function DashboardPage() {
  const router = useRouter()
  const { cities, loading: citiesLoading } = useCities()

  // Level-1: selected region id
  const [activeRegionId, setActiveRegionId] = useState<string>(REGIONS[0].id)
  // Level-2: selected prefecture name_en
  const [activePrefNameEn, setActivePrefNameEn] = useState<string>(
    REGIONS[0].prefectures[0].name_en
  )

  const [selectedArea, setSelectedArea] = useState<Area | null>(null)
  const [filters, setFilters] = useState<DashboardFilters>({
    sortKey: 'transaction_count',
    sortAsc: false,
    search: '',
  })

  // Derive the "active city" from DB or fall back to PrefInfo virtual city
  const activeDbCity = cities.find((c) => c.name_en === activePrefNameEn)
  const activePrefInfo = PREF_BY_NAME_EN[activePrefNameEn]
  const activeCity: City = activeDbCity ?? (activePrefInfo ? prefToVirtualCity(activePrefInfo) : cities[0])

  const { areas, loading: areasLoading } = useAreas(activeDbCity?.id ?? '')

  const filteredAreas = useMemo(() => {
    return areas
      .filter((a) => !filters.search || a.name.includes(filters.search))
      .sort((a, b) => {
        const diff = a[filters.sortKey] - b[filters.sortKey]
        return filters.sortAsc ? diff : -diff
      })
  }, [areas, filters])

  const activeRegion = REGIONS.find((r) => r.id === activeRegionId) ?? REGIONS[0]

  function selectRegion(regionId: string) {
    const region = REGIONS.find((r) => r.id === regionId)!
    setActiveRegionId(regionId)
    setActivePrefNameEn(region.prefectures[0].name_en)
    setSelectedArea(null)
    setFilters((f) => ({ ...f, search: '' }))
  }

  function selectPref(nameEn: string) {
    setActivePrefNameEn(nameEn)
    setSelectedArea(null)
    setFilters((f) => ({ ...f, search: '' }))
  }

  function handleAreaClick(area: Area) {
    setSelectedArea((prev) => (prev?.id === area.id ? null : area))
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  function handleCSVDownload() {
    if (!activeCity) return
    const csv = generateCSV(filteredAreas, activeCity)
    const date = new Date().toISOString().split('T')[0]
    downloadCSV(csv, `population-${activeCity.name_en}-${date}.csv`)
  }

  if (citiesLoading) {
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
      {/* ── Header ── */}
      <header className="bg-slate-800 border-b border-slate-700 flex-shrink-0">
        {/* Row 1: logo + actions */}
        <div className="px-4 py-2.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
              <MapPin className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-white font-bold text-base whitespace-nowrap">人口分析ダッシュボード</h1>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handleCSVDownload}
              disabled={filteredAreas.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-lg text-xs font-medium transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
            <Link
              href="/help"
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
              title="ヘルプ"
            >
              <HelpCircle className="w-4 h-4" />
            </Link>
            <button
              onClick={handleLogout}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
              title="ログアウト"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Row 2: Level-1 region tabs */}
        <div className="px-3 overflow-x-auto border-t border-slate-700/50" style={{ scrollbarWidth: 'none' }}>
          <div className="flex gap-0.5 py-1 min-w-max">
            {REGIONS.map((region) => (
              <button
                key={region.id}
                onClick={() => selectRegion(region.id)}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  region.id === activeRegionId
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700'
                }`}
              >
                {region.name}
              </button>
            ))}
          </div>
        </div>

        {/* Row 3: Level-2 prefecture buttons */}
        <div className="px-3 overflow-x-auto bg-slate-800/40 border-t border-slate-700/50" style={{ scrollbarWidth: 'none' }}>
          <div className="flex gap-1 py-1.5 min-w-max">
            {activeRegion.prefectures.map((pref) => {
              const hasData = cities.some((c) => c.name_en === pref.name_en)
              const isActive = pref.name_en === activePrefNameEn
              return (
                <button
                  key={pref.name_en}
                  onClick={() => selectPref(pref.name_en)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap relative ${
                    isActive
                      ? 'bg-slate-600 text-white ring-1 ring-blue-500'
                      : 'text-slate-400 hover:text-white hover:bg-slate-700'
                  }`}
                >
                  {pref.name}
                  {hasData && (
                    <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-blue-400 rounded-full" title="データあり" />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </header>

      {/* Stats bar */}
      <div className="bg-slate-800/60 border-b border-slate-700 px-4 py-1.5 flex items-center gap-4 flex-shrink-0">
        <span className="text-xs text-slate-400 font-medium">
          {activeCity?.name}
        </span>
        <span className="text-xs text-slate-600">|</span>
        <span className="text-xs text-slate-500">
          {areas.length > 0 ? `${areas.length} 市区町村` : activeDbCity ? '0 市区町村' : 'データなし'}
        </span>
        {areasLoading && (
          <span className="text-xs text-slate-500 flex items-center gap-1 ml-auto">
            <RefreshCw className="w-3 h-3 animate-spin" /> 読み込み中
          </span>
        )}
      </div>

      {/* Main */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar */}
        <aside className="w-64 flex-shrink-0 border-r border-slate-700 overflow-hidden flex flex-col">
          <AreaList
            areas={areas}
            filters={filters}
            onFiltersChange={setFilters}
            selectedAreaId={selectedArea?.id ?? null}
            onAreaClick={handleAreaClick}
          />
        </aside>

        {/* Map + detail panel */}
        <div className="flex-1 relative overflow-hidden">
          {activeCity && (
            <AreaMap
              city={activeCity}
              areas={filteredAreas}
              selectedAreaId={selectedArea?.id ?? null}
              onAreaClick={handleAreaClick}
            />
          )}

          {/* "No data" overlay when prefecture has no DB city */}
          {!activeDbCity && !areasLoading && (
            <div className="absolute inset-0 flex items-end justify-center pb-16 pointer-events-none z-[999]">
              <div className="bg-slate-900/80 backdrop-blur-sm text-slate-300 text-sm px-4 py-2 rounded-xl border border-slate-700">
                📭 {activePrefInfo?.name ?? ''}のデータはまだありません
              </div>
            </div>
          )}

          <AreaDetailPanel
            area={selectedArea}
            onClose={() => setSelectedArea(null)}
          />
        </div>
      </div>
    </div>
  )
}

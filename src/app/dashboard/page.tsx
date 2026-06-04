'use client'

import dynamic from 'next/dynamic'
import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCities, useAreas } from '@/hooks/useAreas'
import { AreaList } from '@/components/ui/AreaList'
import { AreaDetailPanel } from '@/components/ui/AreaDetailPanel'
import { Area, DashboardFilters } from '@/types'
import { generateCSV, downloadCSV } from '@/lib/csv'
import Link from 'next/link'
import { MapPin, LogOut, Download, RefreshCw, HelpCircle } from 'lucide-react'

const AreaMap = dynamic(
  () => import('@/components/map/AreaMap').then((m) => m.AreaMap),
  { ssr: false, loading: () => <div className="w-full h-full bg-slate-700 animate-pulse rounded-lg" /> }
)

export default function DashboardPage() {
  const router = useRouter()
  const { cities, loading: citiesLoading } = useCities()

  const [selectedCityId, setSelectedCityId] = useState<string>('')
  const [selectedArea, setSelectedArea] = useState<Area | null>(null)
  const [filters, setFilters] = useState<DashboardFilters>({
    cityId: '',
    sortKey: 'transaction_count',
    sortAsc: false,
    search: '',
  })

  const activeCityId = selectedCityId || cities[0]?.id || ''
  const { areas, loading: areasLoading } = useAreas(activeCityId)
  const activeCity = cities.find((c) => c.id === activeCityId) ?? cities[0]

  const filteredAreas = useMemo(() => {
    return areas
      .filter((a) => filters.search === '' || a.name.includes(filters.search))
      .sort((a, b) => {
        const diff = a[filters.sortKey] - b[filters.sortKey]
        return filters.sortAsc ? diff : -diff
      })
  }, [areas, filters])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  function handleCSVDownload() {
    if (!activeCity) return
    const csv = generateCSV(filteredAreas, activeCity)
    const date = new Date().toISOString().split('T')[0]
    downloadCSV(csv, `area-data-${activeCity.name_en}-${date}.csv`)
  }

  function handleAreaClick(area: Area) {
    setSelectedArea((prev) => (prev?.id === area.id ? null : area))
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
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-5 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <MapPin className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-white font-bold text-lg">エリア人口分析</h1>
        </div>

        {/* City Tabs */}
        <div className="flex gap-1 flex-wrap justify-center">
          {cities.map((city) => (
            <button
              key={city.id}
              onClick={() => {
                setSelectedCityId(city.id)
                setSelectedArea(null)
              }}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                city.id === activeCityId
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              {city.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCSVDownload}
            disabled={filteredAreas.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" />
            CSV出力
          </button>
          <Link
            href="/help"
            className="flex items-center gap-2 px-3 py-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg text-sm transition-colors"
          >
            <HelpCircle className="w-4 h-4" />
          </Link>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg text-sm transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Stats bar */}
      <div className="bg-slate-800/60 border-b border-slate-700 px-5 py-2 flex items-center gap-6 flex-shrink-0">
        <span className="text-xs text-slate-500">
          {activeCity?.name ?? '—'} ｜ 全{areas.length}市区町村
        </span>
        {areasLoading && (
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <RefreshCw className="w-3 h-3 animate-spin" /> 更新中
          </span>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        <aside className="w-72 flex-shrink-0 border-r border-slate-700 overflow-hidden">
          <AreaList
            areas={areas}
            filters={filters}
            onFiltersChange={setFilters}
            selectedAreaId={selectedArea?.id ?? null}
            onAreaClick={handleAreaClick}
          />
        </aside>

        <div className="flex-1 relative overflow-hidden">
          {activeCity && (
            <AreaMap
              city={activeCity}
              areas={filteredAreas}
              selectedAreaId={selectedArea?.id ?? null}
              onAreaClick={handleAreaClick}
            />
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

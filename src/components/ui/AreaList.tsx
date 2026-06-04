'use client'

import { Area, DashboardFilters, SortKey } from '@/types'
import { ArrowUpDown, TrendingUp, TrendingDown, Search } from 'lucide-react'

interface Props {
  areas: Area[]
  filters: DashboardFilters
  onFiltersChange: (f: DashboardFilters) => void
  selectedAreaId: string | null
  onAreaClick: (area: Area) => void
}

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'transaction_count', label: '人口順' },
  { key: 'population_delta', label: '人口増減率順' },
  { key: 'avg_price_level', label: '人口増減数順' },
]

function fmt(n: number): string {
  if (Math.abs(n) >= 10000) return (n / 10000).toFixed(1) + '万'
  return n.toLocaleString()
}

export function AreaList({ areas, filters, onFiltersChange, selectedAreaId, onAreaClick }: Props) {
  function setSort(key: SortKey) {
    if (filters.sortKey === key) {
      onFiltersChange({ ...filters, sortAsc: !filters.sortAsc })
    } else {
      onFiltersChange({ ...filters, sortKey: key, sortAsc: false })
    }
  }

  const filtered = areas
    .filter((a) =>
      filters.search === '' || a.name.includes(filters.search)
    )
    .sort((a, b) => {
      const diff = a[filters.sortKey] - b[filters.sortKey]
      return filters.sortAsc ? diff : -diff
    })

  return (
    <div className="flex flex-col h-full">
      {/* Filters */}
      <div className="p-3 border-b border-slate-700 space-y-2">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            placeholder="市区町村を検索..."
            value={filters.search}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
            className="w-full bg-slate-700 text-slate-200 text-xs pl-8 pr-3 py-1.5 rounded-lg border border-slate-600 focus:outline-none focus:border-blue-500 placeholder-slate-500"
          />
        </div>

        {/* Sort */}
        <div className="flex gap-1.5 flex-wrap">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setSort(opt.key)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                filters.sortKey === opt.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
              }`}
            >
              {opt.label}
              {filters.sortKey === opt.key && <ArrowUpDown className="w-3 h-3" />}
            </button>
          ))}
        </div>
      </div>

      {/* Count */}
      <div className="px-4 py-2 text-xs text-slate-500 border-b border-slate-700">
        {filtered.length} 市区町村
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.map((area) => (
          <button
            key={area.id}
            onClick={() => onAreaClick(area)}
            className={`w-full text-left px-4 py-3 border-b border-slate-700/50 hover:bg-slate-700/50 transition-colors ${
              selectedAreaId === area.id ? 'bg-slate-700' : ''
            }`}
          >
            <div className="mb-1">
              <span className="text-sm font-medium text-white">{area.name}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>人口 {fmt(area.transaction_count)}人</span>
              <span className={area.population_delta >= 0 ? 'text-emerald-400 flex items-center gap-0.5' : 'text-red-400 flex items-center gap-0.5'}>
                {area.population_delta >= 0
                  ? <TrendingUp className="w-3 h-3" />
                  : <TrendingDown className="w-3 h-3" />}
                {area.population_delta > 0 ? '+' : ''}{area.population_delta.toFixed(2)}%
              </span>
            </div>
          </button>
        ))}

        {filtered.length === 0 && (
          <div className="text-center text-slate-500 py-12 text-sm">
            該当する市区町村がありません
          </div>
        )}
      </div>
    </div>
  )
}

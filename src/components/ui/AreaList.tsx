'use client'

import { Area, DashboardFilters, SortKey } from '@/types'
import { ArrowUpDown, Search } from 'lucide-react'

interface Props {
  areas: Area[]
  filters: DashboardFilters
  onFiltersChange: (f: DashboardFilters) => void
  selectedAreaId: string | null
  onAreaClick: (area: Area) => void
}

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'transaction_count', label: '人口順' },
  { key: 'population_delta',  label: '増減率順' },
  { key: 'avg_price_level',   label: '増減数順' },
]

function fmtPop(n: number): string {
  if (Math.abs(n) >= 10000) return (n / 10000).toFixed(1) + '万'
  return n.toLocaleString()
}

/** 5-tier color for delta value */
function deltaClass(delta: number): string {
  if (delta > 2)  return 'text-blue-500'
  if (delta > 0)  return 'text-blue-400'
  if (delta > -1) return 'text-slate-400'
  if (delta > -3) return 'text-orange-400'
  return                  'text-red-500'
}

function DeltaBadge({ delta }: { delta: number }) {
  const cls  = deltaClass(delta)
  const sign = delta > 0 ? '▲+' : delta < 0 ? '▼' : '▶'
  return (
    <span className={`text-xs font-bold tabular-nums ${cls}`}>
      {sign}{delta.toFixed(2)}%
    </span>
  )
}

export function AreaList({
  areas, filters, onFiltersChange, selectedAreaId, onAreaClick,
}: Props) {
  function setSort(key: SortKey) {
    if (filters.sortKey === key) {
      onFiltersChange({ ...filters, sortAsc: !filters.sortAsc })
    } else {
      onFiltersChange({ ...filters, sortKey: key, sortAsc: false })
    }
  }

  const filtered = areas
    .filter((a) => !filters.search || a.name.includes(filters.search))
    .sort((a, b) => {
      const diff = a[filters.sortKey] - b[filters.sortKey]
      return filters.sortAsc ? diff : -diff
    })

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="p-3 border-b border-slate-700 space-y-2 flex-shrink-0">
        {/* Search box */}
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

        {/* Sort buttons */}
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

      {/* Count row */}
      <div className="px-4 py-1.5 text-xs text-slate-500 border-b border-slate-700 flex-shrink-0">
        {filtered.length} 市区町村
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.map((area) => (
          <button
            key={area.id}
            onClick={() => onAreaClick(area)}
            className={`w-full text-left px-3 py-2.5 border-b border-slate-700/40 hover:bg-slate-700/50 transition-colors ${
              selectedAreaId === area.id ? 'bg-slate-700/80 border-l-2 border-l-blue-500' : ''
            }`}
          >
            {/* Row 1: name + delta badge */}
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-sm font-medium text-white leading-tight truncate mr-2">
                {area.name}
              </span>
              <DeltaBadge delta={area.population_delta} />
            </div>

            {/* Row 2: population + change count */}
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>人口 {fmtPop(area.transaction_count)}人</span>
              {area.avg_price_level !== 0 && (
                <span className={area.avg_price_level >= 0 ? 'text-blue-400/70' : 'text-orange-400/70'}>
                  {area.avg_price_level > 0 ? '+' : ''}
                  {fmtPop(Math.round(area.avg_price_level))}人
                </span>
              )}
            </div>
          </button>
        ))}

        {filtered.length === 0 && (
          <div className="text-center text-slate-500 py-12 text-sm">
            {areas.length === 0 ? 'データがありません' : '該当する市区町村がありません'}
          </div>
        )}
      </div>
    </div>
  )
}

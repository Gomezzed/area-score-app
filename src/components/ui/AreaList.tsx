'use client'

import { Area, DashboardFilters, Tier } from '@/types'
import { TierBadge } from './TierBadge'
import { ArrowUpDown, TrendingUp, TrendingDown } from 'lucide-react'

interface Props {
  areas: Area[]
  filters: DashboardFilters
  onFiltersChange: (f: DashboardFilters) => void
  selectedAreaId: string | null
  onAreaClick: (area: Area) => void
}

const SORT_OPTIONS = [
  { key: 'score' as const, label: 'スコア順' },
  { key: 'transaction_count' as const, label: '取引件数順' },
  { key: 'population_delta' as const, label: '人口増減順' },
]

const TIERS: Tier[] = ['A', 'B', 'C']

export function AreaList({ areas, filters, onFiltersChange, selectedAreaId, onAreaClick }: Props) {
  function toggleTier(tier: Tier) {
    const tiers = filters.tiers.includes(tier)
      ? filters.tiers.filter((t) => t !== tier)
      : [...filters.tiers, tier]
    onFiltersChange({ ...filters, tiers: tiers.length === 0 ? ['A', 'B', 'C'] : tiers })
  }

  function setSort(key: typeof filters.sortKey) {
    if (filters.sortKey === key) {
      onFiltersChange({ ...filters, sortAsc: !filters.sortAsc })
    } else {
      onFiltersChange({ ...filters, sortKey: key, sortAsc: false })
    }
  }

  const filtered = areas
    .filter((a) => filters.tiers.includes(a.tier as Tier))
    .sort((a, b) => {
      const diff = a[filters.sortKey] - b[filters.sortKey]
      return filters.sortAsc ? diff : -diff
    })

  return (
    <div className="flex flex-col h-full">
      {/* Filters */}
      <div className="p-4 border-b border-slate-700 space-y-3">
        {/* Tier filter */}
        <div className="flex gap-2">
          {TIERS.map((tier) => {
            const active = filters.tiers.includes(tier)
            const tierColors: Record<Tier, string> = {
              A: active ? 'bg-emerald-700 text-white border-emerald-600' : 'bg-slate-700 text-slate-400 border-slate-600',
              B: active ? 'bg-amber-700 text-white border-amber-600' : 'bg-slate-700 text-slate-400 border-slate-600',
              C: active ? 'bg-red-700 text-white border-red-600' : 'bg-slate-700 text-slate-400 border-slate-600',
            }
            return (
              <button
                key={tier}
                onClick={() => toggleTier(tier)}
                className={`flex-1 py-1.5 rounded-lg border text-sm font-bold transition-colors ${tierColors[tier]}`}
              >
                Tier {tier}
              </button>
            )
          })}
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
              {filters.sortKey === opt.key && (
                <ArrowUpDown className="w-3 h-3" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Count */}
      <div className="px-4 py-2 text-xs text-slate-500 border-b border-slate-700">
        {filtered.length} エリア表示中
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
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-white truncate mr-2">{area.name}</span>
              <TierBadge tier={area.tier as Tier} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-black text-white">{area.score.toFixed(1)}</span>
              <div className="text-right text-xs text-slate-400 space-y-0.5">
                <div>取引 {area.transaction_count}件</div>
                <div className="flex items-center justify-end gap-0.5">
                  {area.population_delta >= 0 ? (
                    <TrendingUp className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <TrendingDown className="w-3 h-3 text-red-400" />
                  )}
                  <span className={area.population_delta >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {area.population_delta > 0 ? '+' : ''}{area.population_delta.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
            {/* Score bar */}
            <div className="mt-2 h-1 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  area.tier === 'A' ? 'bg-emerald-500' :
                  area.tier === 'B' ? 'bg-amber-500' : 'bg-red-500'
                }`}
                style={{ width: `${Math.min((area.score / 100) * 100, 100)}%` }}
              />
            </div>
          </button>
        ))}

        {filtered.length === 0 && (
          <div className="text-center text-slate-500 py-12 text-sm">
            該当エリアがありません
          </div>
        )}
      </div>
    </div>
  )
}

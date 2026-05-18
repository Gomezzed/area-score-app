'use client'

import { Area } from '@/types'
import { TierBadge } from './TierBadge'
import { X, TrendingUp, TrendingDown, BarChart2, DollarSign } from 'lucide-react'

interface Props {
  area: Area | null
  onClose: () => void
}

export function AreaDetailPanel({ area, onClose }: Props) {
  if (!area) return null

  const scoreBreakdown = [
    {
      label: '取引件数',
      value: area.transaction_count,
      weight: 0.4,
      contribution: area.transaction_count * 0.4,
      unit: '件',
      icon: BarChart2,
    },
    {
      label: '人口増減率',
      value: area.population_delta,
      weight: 0.3,
      contribution: area.population_delta * 0.3,
      unit: '%',
      icon: area.population_delta >= 0 ? TrendingUp : TrendingDown,
      color: area.population_delta >= 0 ? 'text-emerald-400' : 'text-red-400',
    },
    {
      label: '平均価格水準',
      value: area.avg_price_level,
      weight: 0.3,
      contribution: area.avg_price_level * 0.3,
      unit: '万円/㎡',
      icon: DollarSign,
    },
  ]

  return (
    <div className="absolute right-0 top-0 h-full w-80 bg-slate-800 border-l border-slate-700 shadow-2xl z-10 overflow-y-auto">
      <div className="p-5">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-white leading-tight">{area.name}</h2>
            <div className="mt-1.5">
              <TierBadge tier={area.tier as 'A' | 'B' | 'C'} />
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Total Score */}
        <div className="bg-slate-700/50 rounded-xl p-4 mb-5 text-center">
          <div className="text-4xl font-black text-white">{area.score.toFixed(1)}</div>
          <div className="text-slate-400 text-sm mt-1">総合スコア</div>
        </div>

        {/* Score Breakdown */}
        <div className="space-y-3 mb-5">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            スコア内訳
          </h3>
          {scoreBreakdown.map((item) => {
            const Icon = item.icon
            return (
              <div key={item.label} className="bg-slate-700/30 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${item.color ?? 'text-blue-400'}`} />
                    <span className="text-sm text-slate-300">{item.label}</span>
                  </div>
                  <span className="text-xs text-slate-500">×{item.weight}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-lg font-bold ${item.color ?? 'text-white'}`}>
                    {item.value.toFixed(1)}
                    <span className="text-xs font-normal text-slate-400 ml-1">{item.unit}</span>
                  </span>
                  <span className="text-sm text-slate-400">
                    +{item.contribution.toFixed(1)}pt
                  </span>
                </div>
                {/* Progress bar */}
                <div className="mt-2 h-1.5 bg-slate-600 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full"
                    style={{ width: `${Math.min((item.contribution / area.score) * 100, 100)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>

        {/* Formula */}
        <div className="bg-slate-700/20 rounded-lg p-3 text-xs text-slate-500">
          <div className="font-medium text-slate-400 mb-1">スコア計算式</div>
          <div>取引件数×40% + 人口増減率×30% + 平均価格×30%</div>
        </div>
      </div>
    </div>
  )
}

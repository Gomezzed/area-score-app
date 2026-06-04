'use client'

import { Area } from '@/types'
import { useTransactionSummary } from '@/hooks/useTransactions'
import { X, Users, TrendingUp, TrendingDown, BarChart2 } from 'lucide-react'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'

interface Props {
  area: Area | null
  onClose: () => void
}

function fmtPop(n: number): string {
  if (Math.abs(n) >= 10000) return (n / 10000).toFixed(1) + '万'
  return n.toLocaleString()
}

function fmtYen(n: number): string {
  if (n >= 10_000) return Math.round(n / 10_000) + '万'
  return n.toLocaleString()
}

function deltaColor(delta: number): string {
  if (delta > 2)  return 'text-blue-500'
  if (delta > 0)  return 'text-blue-400'
  if (delta > -1) return 'text-slate-400'
  if (delta > -3) return 'text-orange-400'
  return                  'text-red-500'
}

export function AreaDetailPanel({ area, onClose }: Props) {
  const { data: txData, loading: txLoading } = useTransactionSummary(area?.name ?? '')

  if (!area) return null

  const deltaPos = area.population_delta >= 0
  const changePos = area.avg_price_level >= 0
  const latestTx = txData[txData.length - 1]
  const sign = area.population_delta > 0 ? '▲+' : area.population_delta < 0 ? '▼' : '▶'

  return (
    <div className="absolute right-0 top-0 h-full w-80 bg-slate-800 border-l border-slate-700 shadow-2xl z-10 overflow-y-auto">
      <div className="p-4">
        {/* Title row */}
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-base font-bold text-white leading-tight pr-2">{area.name}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Population hero */}
        <div className="bg-slate-700/50 rounded-xl p-4 mb-3">
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-4 h-4 text-blue-400" />
            <span className="text-xs text-slate-400">人口（最新）</span>
          </div>
          <div className="text-3xl font-black text-white">
            {fmtPop(area.transaction_count)}
            <span className="text-sm font-normal text-slate-400 ml-1">人</span>
          </div>
        </div>

        {/* Delta row */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {/* Rate */}
          <div className="bg-slate-700/30 rounded-xl p-3">
            <div className="flex items-center gap-1 mb-1.5">
              {deltaPos
                ? <TrendingUp  className="w-3.5 h-3.5 text-blue-400" />
                : <TrendingDown className="w-3.5 h-3.5 text-orange-400" />}
              <span className="text-xs text-slate-400">増減率</span>
            </div>
            <div className={`text-xl font-bold ${deltaColor(area.population_delta)}`}>
              {sign}{Math.abs(area.population_delta).toFixed(2)}%
            </div>
          </div>
          {/* Count */}
          <div className="bg-slate-700/30 rounded-xl p-3">
            <div className="text-xs text-slate-400 mb-1.5">増減数</div>
            <div className={`text-xl font-bold ${changePos ? 'text-blue-400' : 'text-orange-400'}`}>
              {changePos ? '+' : ''}{fmtPop(Math.round(area.avg_price_level))}
              <span className="text-xs font-normal text-slate-500 ml-0.5">人</span>
            </div>
          </div>
        </div>

        {/* Transaction section */}
        <div className="border-t border-slate-700 pt-3">
          <div className="flex items-center gap-2 mb-3">
            <BarChart2 className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-xs font-semibold text-slate-300">
              不動産取引（中古マンション等）
            </span>
          </div>

          {txLoading && (
            <p className="text-xs text-slate-500 py-3 text-center">読み込み中…</p>
          )}

          {!txLoading && txData.length === 0 && (
            <p className="text-xs text-slate-600 py-3 text-center">取引データなし</p>
          )}

          {txData.length > 0 && (
            <>
              {/* Latest year summary */}
              {latestTx && (
                <div className="bg-slate-700/30 rounded-lg p-3 mb-3 text-xs space-y-1.5">
                  <div className="font-semibold text-slate-200">{latestTx.year}年 直近サマリー</div>
                  <div className="flex justify-between text-slate-400">
                    <span>取引件数</span>
                    <span className="text-white font-medium">{latestTx.count.toLocaleString()}件</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>平均㎡単価</span>
                    <span className="text-white font-medium">{fmtYen(latestTx.avg_price_per_sqm)}円/㎡</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>平均価格</span>
                    <span className="text-white font-medium">{latestTx.avg_total_price.toLocaleString()}万円</span>
                  </div>
                </div>
              )}

              {/* Bar: count by year */}
              <div className="mb-4">
                <p className="text-[11px] text-slate-500 mb-1.5">取引件数（年別）</p>
                <ResponsiveContainer width="100%" height={90}>
                  <BarChart data={txData} margin={{ top: 0, right: 4, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                    <XAxis dataKey="year" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ background: '#1e293b', border: '1px solid #475569', fontSize: 11, borderRadius: 6 }}
                      labelStyle={{ color: '#94a3b8' }}
                      cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    />
                    <Bar dataKey="count" name="件数" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Line: avg ㎡ price */}
              <div>
                <p className="text-[11px] text-slate-500 mb-1.5">平均㎡単価推移</p>
                <ResponsiveContainer width="100%" height={90}>
                  <LineChart data={txData} margin={{ top: 0, right: 4, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                    <XAxis dataKey="year" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 9, fill: '#94a3b8' }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => fmtYen(v)}
                    />
                    <Tooltip
                      contentStyle={{ background: '#1e293b', border: '1px solid #475569', fontSize: 11, borderRadius: 6 }}
                      labelStyle={{ color: '#94a3b8' }}
                      formatter={(v: unknown) => [`${fmtYen(Number(v))}円/㎡`, '平均㎡単価']}
                      cursor={{ stroke: 'rgba(255,255,255,0.1)' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="avg_price_per_sqm"
                      name="㎡単価"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#10b981' }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>

        {/* Source */}
        <div className="mt-4 bg-slate-700/20 rounded-lg p-3 text-[11px] text-slate-500 space-y-0.5">
          <p className="font-medium text-slate-400">データ出典</p>
          <p>人口: e-Stat 住民基本台帳（総務省）</p>
          <p>取引: 国土交通省 不動産取引価格情報</p>
        </div>
      </div>
    </div>
  )
}

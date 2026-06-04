'use client'

import { Area } from '@/types'
import { useTransactionSummary } from '@/hooks/useTransactions'
import { X, TrendingUp, TrendingDown, Users, BarChart2 } from 'lucide-react'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'

interface Props {
  area: Area | null
  onClose: () => void
}

function fmt(n: number): string {
  if (Math.abs(n) >= 10000) return (n / 10000).toFixed(1) + '万'
  return n.toLocaleString()
}

function fmtYen(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(0) + '万'
  return n.toLocaleString()
}

export function AreaDetailPanel({ area, onClose }: Props) {
  const { data: txData, loading: txLoading } = useTransactionSummary(area?.name ?? '')

  if (!area) return null

  const deltaPositive = area.population_delta >= 0
  const changePositive = area.avg_price_level >= 0
  const latestTx = txData[txData.length - 1]

  return (
    <div className="absolute right-0 top-0 h-full w-80 bg-slate-800 border-l border-slate-700 shadow-2xl z-10 overflow-y-auto">
      <div className="p-5">
        <div className="flex items-start justify-between mb-5">
          <h2 className="text-lg font-bold text-white leading-tight">{area.name}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Population stats */}
        <div className="space-y-3 mb-6">
          <div className="bg-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-slate-400">人口（最新）</span>
            </div>
            <div className="text-3xl font-black text-white">
              {fmt(area.transaction_count)}
              <span className="text-sm font-normal text-slate-400 ml-1">人</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-700/30 rounded-xl p-3">
              <div className="text-xs text-slate-400 mb-1">人口増減数</div>
              <div className={`text-lg font-bold ${changePositive ? 'text-emerald-400' : 'text-red-400'}`}>
                {changePositive ? '+' : ''}{fmt(Math.round(area.avg_price_level))}人
              </div>
            </div>
            <div className="bg-slate-700/30 rounded-xl p-3">
              <div className="flex items-center gap-1 mb-1">
                {deltaPositive
                  ? <TrendingUp className="w-3 h-3 text-emerald-400" />
                  : <TrendingDown className="w-3 h-3 text-red-400" />}
                <span className="text-xs text-slate-400">増減率</span>
              </div>
              <div className={`text-lg font-bold ${deltaPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                {area.population_delta > 0 ? '+' : ''}{area.population_delta.toFixed(2)}%
              </div>
            </div>
          </div>
        </div>

        {/* Real estate transactions */}
        <div className="border-t border-slate-700 pt-4">
          <div className="flex items-center gap-2 mb-3">
            <BarChart2 className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-semibold text-slate-300">不動産取引（中古マンション）</span>
          </div>

          {txLoading && (
            <div className="text-xs text-slate-500 py-4 text-center">読み込み中...</div>
          )}

          {!txLoading && txData.length === 0 && (
            <div className="text-xs text-slate-500 py-4 text-center">取引データなし</div>
          )}

          {txData.length > 0 && (
            <>
              {/* Latest year summary */}
              {latestTx && (
                <div className="bg-slate-700/30 rounded-lg p-3 mb-3 text-xs space-y-1">
                  <div className="font-medium text-slate-300">{latestTx.year}年 直近サマリー</div>
                  <div className="flex justify-between text-slate-400">
                    <span>取引件数</span>
                    <span className="text-white font-medium">{latestTx.count}件</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>平均㎡単価</span>
                    <span className="text-white font-medium">{fmtYen(latestTx.avg_price_per_sqm)}円</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>平均価格</span>
                    <span className="text-white font-medium">{latestTx.avg_total_price}万円</span>
                  </div>
                </div>
              )}

              {/* Bar chart: transaction count by year */}
              <div className="mb-4">
                <div className="text-xs text-slate-500 mb-2">取引件数（年別）</div>
                <ResponsiveContainer width="100%" height={100}>
                  <BarChart data={txData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="year" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
                    <Tooltip
                      contentStyle={{ background: '#1e293b', border: '1px solid #475569', fontSize: 11 }}
                      labelStyle={{ color: '#94a3b8' }}
                    />
                    <Bar dataKey="count" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Line chart: avg price per sqm trend */}
              <div>
                <div className="text-xs text-slate-500 mb-2">平均㎡単価推移（円）</div>
                <ResponsiveContainer width="100%" height={100}>
                  <LineChart data={txData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="year" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v) => fmtYen(v)} />
                    <Tooltip
                      contentStyle={{ background: '#1e293b', border: '1px solid #475569', fontSize: 11 }}
                      labelStyle={{ color: '#94a3b8' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="avg_price_per_sqm"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>

        {/* Data source */}
        <div className="mt-5 bg-slate-700/20 rounded-lg p-3 text-xs text-slate-500">
          <div className="font-medium text-slate-400 mb-1">データ出典</div>
          <div>人口: e-Stat 住民基本台帳（総務省）</div>
          <div>取引: 国土交通省 不動産取引価格情報</div>
        </div>
      </div>
    </div>
  )
}

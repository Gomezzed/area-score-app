'use client'

import { MunicipalityWithStats } from '@/types'
import { formatPopulation, formatDelta, deltaColor } from '@/lib/census'
import { TransactionSection } from './TransactionSection'
import { X, Users, Home, TrendingUp, TrendingDown } from 'lucide-react'

interface Props {
  municipality: MunicipalityWithStats | null
  onClose: () => void
}

export function MunicipalityDetailPanel({ municipality: m, onClose }: Props) {
  const open = m != null

  return (
    <div
      className={`absolute inset-y-0 right-0 w-full md:w-96 bg-slate-800 border-l border-slate-700 shadow-2xl z-[1100] overflow-y-auto transition-transform duration-300 ease-out ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
      aria-hidden={!open}
    >
      {m && <PanelBody m={m} onClose={onClose} />}
    </div>
  )
}

function PanelBody({ m, onClose }: { m: MunicipalityWithStats; onClose: () => void }) {
  const positive = (m.deltaRate ?? 0) >= 0

  return (
      <div className="p-5">
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: deltaColor(m.deltaRate) }} />
            <h2 className="text-lg font-bold text-white leading-tight">{m.name}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="flex items-center justify-center min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 -mr-2 md:mr-0 text-slate-400 hover:text-white transition-colors md:p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 人口（2020） */}
        <div className="bg-slate-700/50 rounded-xl p-4 mb-4 text-center">
          <div className="text-3xl font-black text-white">{formatPopulation(m.pop2020)}</div>
          <div className="text-slate-400 text-sm mt-1">人口（2020年・国勢調査）</div>
        </div>

        {/* 増減率 */}
        <div className="bg-slate-700/30 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {positive ? (
                <TrendingUp className="w-5 h-5 text-blue-400" />
              ) : (
                <TrendingDown className="w-5 h-5 text-red-400" />
              )}
              <span className="text-sm text-slate-300">人口増減率（2015→2020）</span>
            </div>
            <span className={`text-xl font-bold ${m.deltaRate == null ? 'text-slate-500' : positive ? 'text-blue-400' : 'text-red-400'}`}>
              {m.deltaRate == null ? '—' : `${positive ? '+' : ''}${m.deltaRate.toFixed(2)}%`}
            </span>
          </div>
          <div className="flex items-center justify-between mt-2 text-sm">
            <span className="text-slate-400">人口増減数</span>
            <span className={m.delta == null ? 'text-slate-500' : positive ? 'text-blue-400' : 'text-red-400'}>
              {formatDelta(m.delta)}
            </span>
          </div>
        </div>

        {/* 内訳 */}
        <div className="space-y-2">
          <Row icon={<Users className="w-4 h-4 text-blue-400" />} label="人口（2015年）" value={formatPopulation(m.pop2015)} />
          <Row icon={<Home className="w-4 h-4 text-blue-400" />} label="世帯数（2020年）" value={m.households2020 == null ? '—' : `${m.households2020.toLocaleString('ja-JP')}世帯`} />
        </div>

        {/* マンション取引履歴 */}
        <TransactionSection municipalityId={m.id} />

        <p className="text-xs text-slate-500 mt-5">
          出典: 総務省統計局 国勢調査（e-Stat）／
          国土交通省 不動産取引価格情報
        </p>
      </div>
  )
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between bg-slate-700/30 rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm text-slate-300">{label}</span>
      </div>
      <span className="text-sm font-semibold text-white">{value}</span>
    </div>
  )
}

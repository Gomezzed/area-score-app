'use client'

import { useState } from 'react'
import { MunicipalityWithStats } from '@/types'
import { formatPopulation, formatDelta, deltaColor, parseWard } from '@/lib/census'
import { Search, ChevronRight, ArrowLeft, Lock } from 'lucide-react'

interface Props {
  municipalities: MunicipalityWithStats[]
  selectedId: string | null
  onSelect: (m: MunicipalityWithStats) => void
  // 区を持つ政令指定都市の名称集合（クリックで区一覧へドリルダウン）
  expandableNames?: Set<string>
  // ドリルダウン中の政令市名（null のときはトップレベル表示）
  drilldownCity?: string | null
  onBack?: () => void
  // ロックされた項目クリック時のハンドラ（アップグレード導線）
  onLockedClick?: () => void
}

export function MunicipalityList({
  municipalities,
  selectedId,
  onSelect,
  expandableNames,
  drilldownCity,
  onBack,
  onLockedClick,
}: Props) {
  const [search, setSearch] = useState('')

  const q = search.trim().toLowerCase()
  const filtered = q
    ? municipalities.filter((m) => m.name.toLowerCase().includes(q))
    : municipalities

  // ロック判定はサーバー（get_municipalities_gated）が確定した m.locked を使用する。
  //   Free 閲覧ルール v3 に従いロック行は数値が NULL 化されて届く。検索では回避できない。
  const isLocked = (m: MunicipalityWithStats) => m.locked === true

  return (
    <div className="flex flex-col h-full bg-white">
      {/* ドリルダウン中: 戻るヘッダー */}
      {drilldownCity && (
        <button
          onClick={onBack}
          className="flex items-center gap-2 w-full px-3 min-h-[44px] py-2 bg-slate-50 hover:bg-slate-100 border-b border-slate-100 text-left transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-brand-700 flex-shrink-0" />
          <span className="text-sm font-medium text-slate-900 truncate">{drilldownCity}</span>
          <span className="text-xs text-slate-400 ml-auto flex-shrink-0">区一覧</span>
        </button>
      )}

      {/* 検索 */}
      <div className="p-3 border-b border-slate-100">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={drilldownCity ? '区名で検索…' : '市区町村名で検索…'}
            className="w-full pl-8 pr-3 min-h-[44px] sm:min-h-0 py-2 sm:py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:border-brand-700"
          />
        </div>
      </div>

      <div className="px-3 py-2 text-xs text-slate-500 border-b border-slate-100">
        {filtered.length} {drilldownCity ? '区' : '市区町村'}
      </div>

      {/* リスト */}
      <div className="flex-1 overflow-y-auto">
        {filtered.map((m) => {
          const positive = (m.deltaRate ?? 0) >= 0
          const rateColor = m.deltaRate == null ? 'text-slate-500' : positive ? 'text-delta-up' : 'text-delta-down'
          const expandable = !drilldownCity && expandableNames?.has(m.name)
          const ward = drilldownCity ? parseWard(m.name) : null
          const displayName = ward ? ward.ward : m.name
          const locked = isLocked(m)

          // 無料プラン: ロック項目はぼかし + 鍵アイコン。クリックでアップグレード導線へ
          if (locked) {
            return (
              <button
                key={m.id}
                onClick={() => onLockedClick?.()}
                className="w-full text-left px-3 min-h-[44px] py-2.5 border-b border-slate-100 hover:bg-slate-50 transition-colors relative group"
                title="アップグレードして全データを表示"
              >
                <div className="select-none blur-[3px] opacity-60 pointer-events-none">
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: deltaColor(m.deltaRate) }}
                      />
                      <span className="text-sm font-medium text-slate-900 truncate">{displayName}</span>
                    </div>
                    <span className="text-sm font-bold text-slate-900 whitespace-nowrap ml-2">
                      {formatPopulation(m.popLatest)}
                    </span>
                  </div>
                  <div className="pl-[1.125rem]">
                    <span className={`text-xs font-semibold ${rateColor}`}>▲ —%</span>
                  </div>
                </div>
                <span className="absolute inset-0 flex items-center justify-center gap-1.5 text-xs font-medium text-slate-500">
                  <Lock className="w-3.5 h-3.5 text-brand-700" />
                  アップグレードで表示
                </span>
              </button>
            )
          }

          return (
            <button
              key={m.id}
              onClick={() => onSelect(m)}
              className={`w-full text-left px-3 min-h-[44px] py-2.5 border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                selectedId === m.id ? 'bg-slate-100' : ''
              }`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: deltaColor(m.deltaRate) }}
                  />
                  <span className="text-sm font-medium text-slate-900 truncate">{displayName}</span>
                  {expandable && (
                    <span className="text-[10px] text-slate-500 bg-slate-100 rounded px-1 py-px flex-shrink-0">
                      政令市
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                  <span className="text-sm font-bold text-slate-900 whitespace-nowrap">
                    {formatPopulation(m.popLatest)}
                  </span>
                  {expandable && <ChevronRight className="w-4 h-4 text-slate-400" />}
                </div>
              </div>
              <div className="flex items-center justify-between pl-[1.125rem]">
                <span className={`text-xs font-semibold ${rateColor}`}>
                  {m.deltaRate == null ? '—' : (
                    <>
                      {positive ? '▲' : '▼'} {Math.abs(m.deltaRate).toFixed(2)}%
                    </>
                  )}
                </span>
                <span className={`text-xs ${rateColor}`}>
                  {formatDelta(m.delta)}
                </span>
              </div>
            </button>
          )
        })}

        {filtered.length === 0 && (
          <div className="text-center text-slate-500 py-12 text-sm">
            該当する{drilldownCity ? '区' : '市区町村'}がありません
          </div>
        )}
      </div>
    </div>
  )
}

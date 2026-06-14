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
  // 無料プラン制限: このインデックス以降の項目をロック表示する（null で無制限）
  lockedFromIndex?: number | null
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
  lockedFromIndex = null,
  onLockedClick,
}: Props) {
  const [search, setSearch] = useState('')

  const q = search.trim().toLowerCase()
  const filtered = q
    ? municipalities.filter((m) => m.name.toLowerCase().includes(q))
    : municipalities

  // ロック判定は全体リスト内の順位で行う（検索で回避できないようにする）
  const rankById = new Map(municipalities.map((m, i) => [m.id, i]))
  const isLocked = (m: MunicipalityWithStats) =>
    lockedFromIndex != null && (rankById.get(m.id) ?? 0) >= lockedFromIndex

  return (
    <div className="flex flex-col h-full">
      {/* ドリルダウン中: 戻るヘッダー */}
      {drilldownCity && (
        <button
          onClick={onBack}
          className="flex items-center gap-2 w-full px-3 min-h-[44px] py-2 bg-slate-700/60 hover:bg-slate-700 border-b border-slate-700 text-left transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-blue-400 flex-shrink-0" />
          <span className="text-sm font-medium text-white truncate">{drilldownCity}</span>
          <span className="text-xs text-slate-400 ml-auto flex-shrink-0">区一覧</span>
        </button>
      )}

      {/* 検索 */}
      <div className="p-3 border-b border-slate-700">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={drilldownCity ? '区名で検索…' : '市区町村名で検索…'}
            className="w-full pl-8 pr-3 min-h-[44px] sm:min-h-0 py-2 sm:py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      <div className="px-3 py-2 text-xs text-slate-500 border-b border-slate-700">
        {filtered.length} {drilldownCity ? '区' : '市区町村'}
      </div>

      {/* リスト */}
      <div className="flex-1 overflow-y-auto">
        {filtered.map((m) => {
          const positive = (m.deltaRate ?? 0) >= 0
          const rateColor = m.deltaRate == null ? 'text-slate-500' : positive ? 'text-blue-400' : 'text-red-400'
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
                className="w-full text-left px-3 min-h-[44px] py-2.5 border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors relative group"
                title="アップグレードして全データを表示"
              >
                <div className="select-none blur-[3px] opacity-60 pointer-events-none">
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: deltaColor(m.deltaRate) }}
                      />
                      <span className="text-sm font-medium text-white truncate">{displayName}</span>
                    </div>
                    <span className="text-sm font-bold text-white whitespace-nowrap ml-2">
                      {formatPopulation(m.popLatest)}
                    </span>
                  </div>
                  <div className="pl-[1.125rem]">
                    <span className={`text-xs font-semibold ${rateColor}`}>▲ —%</span>
                  </div>
                </div>
                <span className="absolute inset-0 flex items-center justify-center gap-1.5 text-xs font-medium text-slate-300">
                  <Lock className="w-3.5 h-3.5 text-blue-400" />
                  アップグレードで表示
                </span>
              </button>
            )
          }

          return (
            <button
              key={m.id}
              onClick={() => onSelect(m)}
              className={`w-full text-left px-3 min-h-[44px] py-2.5 border-b border-slate-700/50 hover:bg-slate-700/50 transition-colors ${
                selectedId === m.id ? 'bg-slate-700' : ''
              }`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: deltaColor(m.deltaRate) }}
                  />
                  <span className="text-sm font-medium text-white truncate">{displayName}</span>
                  {expandable && (
                    <span className="text-[10px] text-slate-400 bg-slate-700 rounded px-1 py-px flex-shrink-0">
                      政令市
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                  <span className="text-sm font-bold text-white whitespace-nowrap">
                    {formatPopulation(m.popLatest)}
                  </span>
                  {expandable && <ChevronRight className="w-4 h-4 text-slate-500" />}
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

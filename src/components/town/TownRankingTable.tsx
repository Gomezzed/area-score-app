/**
 * ============================================================================
 *  src/components/town/TownRankingTable.tsx
 *  町丁目別 若返り・ファミリー流入 ランキングテーブル
 * ============================================================================
 *  - inflow_score 降順がデフォルト
 *  - カラム見出しクリックでソート切替
 *  - 「若返り」フィルタトグル
 *  - 行クリックで選択 (親に通知してグラフ表示と連動)
 * ============================================================================
 */
'use client'

import { useMemo, useState } from 'react'
import type { InflowRankingRow, InflowSortKey } from '@/types/town'
import { TownInflowBadge } from './TownInflowBadge'
import { sortInflowRows } from '@/hooks/useTownInflow'
import { ArrowUp, ArrowDown, Filter, Search } from 'lucide-react'

interface Props {
  rows:             InflowRankingRow[]
  loading:          boolean
  selectedTownId:   string | null
  onSelect:         (row: InflowRankingRow) => void
  /** 取引回数(暫定): 国交省データ投入前は 0 を返すコールバック */
  transactionCountResolver?: (townId: string) => number
}

interface Column {
  key:      InflowSortKey
  label:    string
  align:    'left' | 'right'
  width?:   string
  render:   (row: InflowRankingRow, ctx: { rank: number; tx: number }) => React.ReactNode
}

function fmtNum(n: number): string {
  return n.toLocaleString()
}

export function TownRankingTable({
  rows,
  loading,
  selectedTownId,
  onSelect,
  transactionCountResolver,
}: Props) {
  const [sortKey, setSortKey]   = useState<InflowSortKey>('inflow_score')
  const [sortAsc, setSortAsc]   = useState<boolean>(false)
  const [inflowOnly, setInflowOnly] = useState<boolean>(false)
  const [search, setSearch]     = useState<string>('')

  const filteredSorted = useMemo(() => {
    let r = rows
    if (inflowOnly) r = r.filter((x) => x.is_young_family_inflow)
    if (search)     r = r.filter((x) => x.town_name.includes(search))
    return sortInflowRows(r, sortKey, sortAsc)
  }, [rows, inflowOnly, search, sortKey, sortAsc])

  const columns: Column[] = [
    {
      key:   'inflow_score', // 順位はソート対象でないが、ソートキーから再計算
      label: '#',
      align: 'right',
      width: 'w-10',
      render: (_row, { rank }) => (
        <span className="text-slate-500 tabular-nums">{rank}</span>
      ),
    },
    {
      key:   'inflow_score', // 名前列は触らずダミー
      label: '町丁目',
      align: 'left',
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-white font-medium truncate">{row.town_name}</span>
          <span className="text-[10px] text-slate-500 truncate">{row.oaza_name}{row.chome_name ?? ''}</span>
        </div>
      ),
    },
    {
      key:   'inflow_score',
      label: 'スコア',
      align: 'right',
      width: 'w-20',
      render: (row) => (
        <span className="font-bold text-blue-300 tabular-nums">{row.inflow_score.toFixed(1)}</span>
      ),
    },
    {
      key:   'family_index',
      label: 'ファミリー指数',
      align: 'right',
      width: 'w-24',
      render: (row) => (
        <span className={`tabular-nums font-medium ${row.family_index > 0 ? 'text-emerald-400' : row.family_index < 0 ? 'text-orange-400' : 'text-slate-500'}`}>
          {row.family_index > 0 ? '+' : ''}{fmtNum(row.family_index)}
        </span>
      ),
    },
    {
      key:   'population_delta_abs',
      label: '人口増減',
      align: 'right',
      width: 'w-24',
      render: (row) => (
        <div className="flex flex-col items-end">
          <span className={`tabular-nums text-sm font-medium ${row.population_delta_abs >= 0 ? 'text-emerald-400' : 'text-orange-400'}`}>
            {row.population_delta_abs >= 0 ? '+' : ''}{fmtNum(row.population_delta_abs)}
          </span>
          <span className="text-[10px] text-slate-500 tabular-nums">
            ({row.population_delta_pct >= 0 ? '+' : ''}{row.population_delta_pct.toFixed(1)}%)
          </span>
        </div>
      ),
    },
    {
      key:   'young_family_delta_pct',
      label: '20-49歳%',
      align: 'right',
      width: 'w-20',
      render: (row) => (
        <span className={`tabular-nums ${row.young_family_delta_pct >= 0 ? 'text-pink-300' : 'text-slate-500'}`}>
          {row.young_family_delta_pct >= 0 ? '+' : ''}{row.young_family_delta_pct.toFixed(1)}%
        </span>
      ),
    },
    {
      key:   'inflow_score',
      label: '若返り判定',
      align: 'left',
      width: 'w-28',
      render: (row) => <TownInflowBadge active={row.is_young_family_inflow} compact />,
    },
    {
      key:   'inflow_score',
      label: '取引回数',
      align: 'right',
      width: 'w-20',
      render: (row, { tx }) => (
        <span className="tabular-nums text-slate-300">
          {tx > 0 ? `${fmtNum(tx)}件` : (
            <span className="text-slate-600 text-[10px]">—</span>
          )}
        </span>
      ),
    },
  ]

  function handleHeaderClick(key: InflowSortKey) {
    if (sortKey === key) {
      setSortAsc((v) => !v)
    } else {
      setSortKey(key)
      setSortAsc(false)
    }
  }

  return (
    <div className="h-full flex flex-col bg-slate-800/30">
      {/* ツールバー */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700/60 bg-slate-800/60 flex-shrink-0">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="町丁目で絞り込み"
            className="w-full bg-slate-900/60 border border-slate-700 rounded-md pl-7 pr-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={() => setInflowOnly((v) => !v)}
          className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors ${
            inflowOnly
              ? 'bg-pink-500/15 text-pink-300 border-pink-500/40'
              : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
          }`}
        >
          <Filter className="w-3 h-3" />
          若返りエリアのみ
        </button>
        <div className="ml-auto text-[11px] text-slate-500 tabular-nums">
          {loading ? '読み込み中…' : `${filteredSorted.length} / ${rows.length} 件`}
        </div>
      </div>

      {/* テーブル */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-800/95 backdrop-blur-sm z-10 border-b border-slate-700">
            <tr>
              {columns.map((col, i) => {
                const isSortable = i > 1 // 順位・名前列はソート対象から外す
                const active = isSortable && sortKey === col.key
                return (
                  <th
                    key={i}
                    onClick={() => isSortable && handleHeaderClick(col.key)}
                    className={`px-2 py-2 ${col.width ?? ''} text-${col.align} text-slate-400 font-semibold uppercase tracking-wider text-[10px] ${
                      isSortable ? 'cursor-pointer hover:text-white select-none' : ''
                    }`}
                  >
                    <span className="inline-flex items-center gap-0.5">
                      {col.label}
                      {active && (sortAsc
                        ? <ArrowUp   className="w-3 h-3" />
                        : <ArrowDown className="w-3 h-3" />)}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {filteredSorted.map((row, idx) => {
              const tx = transactionCountResolver?.(row.town_id) ?? 0
              const selected = selectedTownId === row.town_id
              return (
                <tr
                  key={row.town_id}
                  onClick={() => onSelect(row)}
                  className={`border-b border-slate-700/40 cursor-pointer transition-colors ${
                    selected
                      ? 'bg-blue-600/15 ring-1 ring-inset ring-blue-500/40'
                      : 'hover:bg-slate-700/30'
                  }`}
                >
                  {columns.map((col, i) => (
                    <td key={i} className={`px-2 py-1.5 text-${col.align} align-middle`}>
                      {col.render(row, { rank: idx + 1, tx })}
                    </td>
                  ))}
                </tr>
              )
            })}
            {!loading && filteredSorted.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="text-center text-slate-500 py-12 text-xs">
                  該当する町丁目がありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

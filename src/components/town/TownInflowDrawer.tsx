/**
 * ============================================================================
 *  src/components/town/TownInflowDrawer.tsx  (v2: PDF出力ボタン統合済)
 *  町丁目分析 ドロワー (ボトムシート)
 * ============================================================================
 *  既存 dashboard の地図UI/区マーカー/AreaDetailPanel を一切壊さず、
 *  画面下半分にスライドアップする独立レイヤとして表示する設計。
 *
 *  - 左ペイン: ランキングテーブル
 *  - 右ペイン: 選択町丁目の人口推移グラフ
 *  - ヘッダ: PDF出力ボタン (タスク #7)
 *  - X ボタン or Esc で閉じる
 *  - 全国47都道府県に対応: cityNameEn (PrefInfo.name_en) を渡せばOK
 * ============================================================================
 */
'use client'

import { useState, useEffect } from 'react'
import { X, ChevronDown, ChevronUp, BarChart3 } from 'lucide-react'
import { useTownInflowRanking } from '@/hooks/useTownInflow'
import { TownRankingTable } from './TownRankingTable'
import { TownPopulationChart } from './TownPopulationChart'
import { TownReportButton } from './TownReportButton'
import type { InflowRankingRow } from '@/types/town'
import { PREF_NAME_BY_NAME_EN } from '@/lib/prefecture_codes'

interface Props {
  /** PrefInfo.name_en (例: "kagoshima") — 全国47都道府県横展開対応 */
  cityNameEn: string
  /** 表示用都市名 (例: "鹿児島") */
  cityName?:  string
  onClose:    () => void
}

export function TownInflowDrawer({ cityNameEn, cityName, onClose }: Props) {
  const { rows, loading, error } = useTownInflowRanking(cityNameEn)
  const [selectedTownId, setSelectedTownId] = useState<string | null>(null)
  const [selectedRow, setSelectedRow]       = useState<InflowRankingRow | null>(null)
  const [expanded, setExpanded]             = useState<boolean>(false)

  // 初回ロード時、最上位の町丁目を自動選択
  useEffect(() => {
    if (rows.length > 0 && !selectedTownId) {
      setSelectedTownId(rows[0].town_id)
      setSelectedRow(rows[0])
    }
  }, [rows, selectedTownId])

  // Esc キーで閉じる
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  function handleSelect(row: InflowRankingRow) {
    setSelectedTownId(row.town_id)
    setSelectedRow(row)
  }

  const heightClass = expanded ? 'h-[calc(100vh-60px)]' : 'h-[55vh]'
  const prefDisplay = PREF_NAME_BY_NAME_EN[cityNameEn] ?? cityName ?? cityNameEn

  return (
    <>
      {/* 半透明オーバーレイ */}
      <div
        className="fixed inset-0 bg-slate-950/30 backdrop-blur-[1px] z-[1500]"
        onClick={onClose}
        aria-hidden
      />

      {/* ドロワー本体 (ボトム固定) */}
      <div
        className={`fixed bottom-0 left-0 right-0 ${heightClass} bg-slate-900 border-t-2 border-slate-700 shadow-2xl z-[1501] flex flex-col transition-[height] duration-200 ease-out`}
        role="dialog"
        aria-modal="true"
        aria-label="町丁目分析ドロワー"
      >
        {/* ヘッダ */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700 bg-slate-800 flex-shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <BarChart3 className="w-4 h-4 text-pink-400 flex-shrink-0" />
            <h2 className="text-sm font-semibold text-white whitespace-nowrap">
              町丁目分析 <span className="text-slate-400 font-normal">/ {prefDisplay}</span>
            </h2>
            {rows.length > 0 && (
              <span className="ml-2 text-[11px] text-slate-500 whitespace-nowrap truncate">
                {rows.length} 町丁目 / うち若返り判定 {rows.filter((r) => r.is_young_family_inflow).length} 件
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* タスク #7: PDF レポート出力 */}
            <TownReportButton
              cityNameEn={cityNameEn}
              cityName={prefDisplay}
              rows={rows}
            />
            <button
              onClick={() => setExpanded((v) => !v)}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-md transition-colors"
              title={expanded ? '通常サイズに戻す' : '全画面表示'}
            >
              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-md transition-colors"
              title="閉じる (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* エラー帯 */}
        {error && (
          <div className="bg-rose-900/30 border-b border-rose-700/50 text-rose-200 text-[11px] px-4 py-1.5">
            ⚠ ランキング取得エラー: {error}
          </div>
        )}

        {/* ロード/空状態 */}
        {!loading && !error && rows.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-slate-500 text-sm flex-col gap-2 px-6 text-center">
            <span className="text-3xl">📭</span>
            <div>
              <p className="font-medium text-slate-400">
                {prefDisplay} の町丁目データはまだ投入されていません
              </p>
              <p className="text-[11px] text-slate-600 mt-1">
                <code className="bg-slate-800 px-1 py-0.5 rounded">
                  python scripts/build_young_family_inflow.py --city {cityNameEn} --pref-code XX
                </code>
                {' '}を実行するとここに町丁目ランキングが表示されます。
              </p>
            </div>
          </div>
        )}

        {/* メインコンテンツ */}
        {rows.length > 0 && (
          <div className="flex-1 flex min-h-0">
            <div className="flex-1 min-w-0 border-r border-slate-700">
              <TownRankingTable
                rows={rows}
                loading={loading}
                selectedTownId={selectedTownId}
                onSelect={handleSelect}
              />
            </div>
            <div className="w-[420px] flex-shrink-0 bg-slate-900">
              <TownPopulationChart
                townId={selectedTownId}
                townName={selectedRow?.town_name}
              />
            </div>
          </div>
        )}
      </div>
    </>
  )
}

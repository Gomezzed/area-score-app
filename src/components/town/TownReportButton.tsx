/**
 * ============================================================================
 *  src/components/town/TownReportButton.tsx
 *  町丁目分析 PDFレポート 出力ボタン (タスク #7)
 * ============================================================================
 *  - @react-pdf/renderer を「クリック時のみ」動的 import
 *    → メインバンドルに含まれず初期ロード負荷ゼロ
 *  - 上位 N 町丁目 (既定 5) の人口推移を /api/towns/population-history から取得
 *  - TownReportPDF を組み立てて Blob 化 → ブラウザでダウンロード
 * ============================================================================
 */
'use client'

import { useState } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import type { InflowRankingRow } from '@/types/town'
import type { PopulationPoint } from '@/hooks/useTownInflow'

interface Props {
  cityNameEn:        string
  cityName:          string
  rows:              InflowRankingRow[]
  /** PDF に折れ線グラフを含める上位 N 件 (既定: 5) */
  topNForCharts?:    number
  className?:        string
}

/**
 * 単一町丁目の人口推移を取得
 */
async function fetchPopulationHistory(townId: string): Promise<PopulationPoint[]> {
  const res = await fetch(
    `/api/towns/population-history?townId=${encodeURIComponent(townId)}`,
    { cache: 'no-store' },
  )
  if (!res.ok) {
    console.warn('[TownReport] population-history fetch failed', townId, res.status)
    return []
  }
  const body = await res.json()
  return body.points ?? []
}

export function TownReportButton({
  cityNameEn,
  cityName,
  rows,
  topNForCharts = 5,
  className,
}: Props) {
  const [generating, setGenerating] = useState(false)
  const [progress,   setProgress]   = useState<string>('')

  async function handleClick() {
    if (rows.length === 0 || generating) return
    setGenerating(true)
    setProgress('PDF エンジン読み込み中…')

    try {
      // 1. 必要なモジュールを動的 import (初回のみ ~600KB)
      const [{ pdf }, { TownReportPDF }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./TownReportPDF'),
      ])

      // 2. TOP 20 / TOP N の抽出
      const top20 = rows.slice(0, 20)
      const topN  = rows.slice(0, topNForCharts)

      // 3. TOP N の人口推移データを取得 (並列)
      setProgress(`上位 ${topNForCharts} 町丁目の推移データ取得中…`)
      const histories = await Promise.all(
        topN.map(async (row) => ({
          row,
          points: await fetchPopulationHistory(row.town_id),
        })),
      )

      // 4. PDF Document を組み立て → Blob 化
      setProgress('PDF レンダリング中…')
      const inflowCount = rows.filter((r) => r.is_young_family_inflow).length
      const doc = (
        <TownReportPDF
          cityNameEn={cityNameEn}
          cityName={cityName}
          top20={top20}
          histories={histories}
          totalCount={rows.length}
          inflowCount={inflowCount}
        />
      )
      const blob = await pdf(doc).toBlob()

      // 5. ダウンロードトリガー (file-saver なしで直接)
      setProgress('ダウンロード開始…')
      const url = URL.createObjectURL(blob)
      const a   = document.createElement('a')
      const ts  = new Date().toISOString().replace(/[:.]/g, '-').split('Z')[0]
      a.href     = url
      a.download = `town-report-${cityNameEn}-${ts}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      // 少し待ってから revoke (Safari 等で即時 revoke すると失敗する事がある)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown error'
      console.error('[TownReport] PDF generation failed:', msg, e)
      alert('PDF の生成に失敗しました: ' + msg)
    } finally {
      setGenerating(false)
      setProgress('')
    }
  }

  const disabled = generating || rows.length === 0

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      title={
        rows.length === 0
          ? '町丁目データを読み込むと PDF 出力が有効になります'
          : `ランキング TOP 20 ＋ 上位 ${topNForCharts} 町丁目の人口推移を PDF で出力`
      }
      className={
        className ??
        'flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:cursor-not-allowed text-white rounded-md text-[11px] font-medium transition-colors'
      }
    >
      {generating
        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
        : <FileText className="w-3.5 h-3.5" />}
      {generating ? (progress || 'PDF 生成中…') : 'PDF 出力'}
    </button>
  )
}

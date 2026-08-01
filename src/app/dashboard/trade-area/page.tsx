'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, FileText, Sparkles, Info, Lock, Loader2 } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { useSubscription } from '@/hooks/useSubscription'
import { usePrefectures, useMunicipalities } from '@/hooks/useCensus'
import { PrefectureDropdown } from '@/components/ui/PrefectureDropdown'
import { canUse } from '@/lib/plans'
import { CENSUS, formatPopulation, formatDelta, formatRate } from '@/lib/census'

// ── /api/trade-area のレスポンス型（サーバーと対応） ──
interface Confirmed {
  popLatest: number | null
  popPrev: number | null
  popPrev2: number | null
  householdsLatest: number | null
  delta: number | null
  deltaRate: number | null
  stationPassengersTotal: number
}
type Inferred =
  | { hasData: false }
  | {
      hasData: true
      asOf: string
      townCount: number
      rankCounts: { S: number; A: number; B: number; C: number; D: number }
      topAcquisitionScore: number | null
      topReason: string | null
    }
interface AreaSummary {
  id: string
  name: string
  prefectureCode: string | null
  confirmed: Confirmed
  inferred: Inferred
}

const RANK_CHIP: Record<string, string> = {
  S: 'bg-rose-50 text-rose-700 ring-rose-200',
  A: 'bg-[#FAEEDA] text-[#854F0B] ring-amber-300',
  B: 'bg-brand-100 text-brand-700 ring-brand-300',
  C: 'bg-slate-100 text-slate-600 ring-slate-300',
  D: 'bg-slate-100 text-slate-600 ring-slate-300',
}

export default function TradeAreaPage() {
  const { plan } = useSubscription()
  const allowed = canUse(plan, 'tradeAreaReport')
  const withLogo = canUse(plan, 'pdfLogo')
  const { prefectures } = usePrefectures()

  const [prefCode, setPrefCode] = useState('')
  const [muniId, setMuniId] = useState('')
  const [summary, setSummary] = useState<AreaSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)

  const { municipalities } = useMunicipalities(prefCode)
  const prefName = prefectures.find((p) => p.code === prefCode)?.name ?? null

  useEffect(() => {
    if (!allowed || !muniId) return
    let mounted = true
    async function load() {
      try {
        const res = await fetch(`/api/trade-area?municipality_id=${encodeURIComponent(muniId)}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as AreaSummary
        if (mounted) {
          setSummary(json)
          setError(null)
        }
      } catch {
        if (mounted) setError('読み込みに失敗しました')
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [allowed, muniId])

  async function handleDownloadPDF() {
    if (!summary) return
    setPdfLoading(true)
    try {
      // @react-pdf/renderer は重く SSR 不可のため、クリック時に動的 import（pdf.tsx 作法）。
      const { downloadTradeAreaPDF } = await import('@/lib/pdf')
      await downloadTradeAreaPDF({
        name: summary.name,
        prefectureName: prefName,
        confirmed: summary.confirmed,
        inferred: summary.inferred,
        withLogo,
      })
    } catch (err) {
      alert(`PDF生成に失敗しました: ${String(err)}`)
    } finally {
      setPdfLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-page-bg text-slate-900">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Logo size="sm" showWordmark={false} />
            <h1 className="flex items-center gap-2 font-bold text-base truncate">
              <FileText className="w-4 h-4 text-brand-700" />
              商圏レポート
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#FAEEDA] text-[#854F0B]">
                <Sparkles className="w-3 h-3" /> Platinum
              </span>
            </h1>
          </div>
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-500 hover:text-brand-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">ダッシュボードへ戻る</span>
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        {!allowed ? (
          <GatedFallback />
        ) : (
          <>
            {/* 市区町村選択 */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6">
              <div className="text-xs font-bold text-slate-500 mb-2">対象の市区町村を選択</div>
              <div className="flex flex-col sm:flex-row gap-2">
                <PrefectureDropdown
                  prefectures={prefectures as never}
                  selectedCode={prefCode}
                  onSelect={(c) => {
                    setPrefCode(c)
                    setMuniId('')
                    setSummary(null)
                  }}
                />
                <select
                  value={muniId}
                  onChange={(e) => {
                    setMuniId(e.target.value)
                    setSummary(null)
                  }}
                  disabled={!prefCode || municipalities.length === 0}
                  className="flex-1 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm px-3 py-2 disabled:opacity-50 focus:outline-none focus:border-brand-700"
                >
                  <option value="">{prefCode ? '市区町村を選択' : '都道府県を先に選択'}</option>
                  {municipalities.map((m) => (
                    <option key={m.id} value={m.id} className="bg-white">
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {!muniId && (
              <div className="bg-white border border-slate-200 rounded-xl py-12 text-center text-slate-500 text-sm">
                商圏レポートを作成する市区町村を選択してください。
              </div>
            )}
            {muniId && error && (
              <div className="bg-white border border-slate-200 rounded-xl py-12 text-center text-slate-500 text-sm">
                {error}
              </div>
            )}
            {muniId && !error && !summary && (
              <div className="text-slate-500 text-sm py-12 text-center">読み込み中…</div>
            )}
            {muniId && !error && summary && (
              <>
                <Preview summary={summary} prefName={prefName} />
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={handleDownloadPDF}
                    disabled={pdfLoading}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-700 hover:bg-brand-500 disabled:opacity-60 text-white text-sm font-bold transition-colors"
                  >
                    {pdfLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                    PDFをダウンロード
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function Preview({ summary, prefName }: { summary: AreaSummary; prefName: string | null }) {
  const c = summary.confirmed
  const inf = summary.inferred
  return (
    <div className="space-y-5">
      <div className="text-lg font-bold text-slate-900">
        {[prefName, summary.name].filter(Boolean).join(' ')}
      </div>

      {/* 確定セクション（青） */}
      <section className="rounded-xl overflow-hidden border border-brand-300">
        <div className="bg-brand-100 border-l-4 border-brand-700 px-4 py-2">
          <h2 className="text-sm font-bold text-brand-700">確定（公表値・事実）</h2>
        </div>
        <div className="divide-y divide-slate-100">
          <Row label={`人口（${CENSUS.latestLabel}）`} value={formatPopulation(c.popLatest)} />
          <Row label={`人口（${CENSUS.prevLabel}）`} value={formatPopulation(c.popPrev)} />
          <Row label={`人口（${CENSUS.prev2Label}）`} value={formatPopulation(c.popPrev2)} />
          <Row label={`世帯数（${CENSUS.latestLabel}）`} value={c.householdsLatest == null ? '—' : `${c.householdsLatest.toLocaleString('ja-JP')}世帯`} />
          <Row label={`人口増減数（${CENSUS.deltaRangeLabel}）`} value={formatDelta(c.delta)} />
          <Row label={`人口増減率（${CENSUS.deltaRangeLabel}）`} value={formatRate(c.deltaRate)} />
          <Row label="駅乗降客数（合計・最新）" value={c.stationPassengersTotal ? `${c.stationPassengersTotal.toLocaleString('ja-JP')}人/日` : '—'} />
        </div>
      </section>

      {/* 推定セクション（橙＋推定バッジ） */}
      <section className="rounded-xl overflow-hidden border border-amber-300">
        <div className="bg-[#FAEEDA]/50 border-l-4 border-amber-400 px-4 py-2 flex items-center gap-2">
          <h2 className="text-sm font-bold text-[#854F0B]">推定（ルールベース・参考値）</h2>
          <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-[#FAEEDA] text-[#854F0B] ring-1 ring-amber-300">
            推定
          </span>
        </div>
        <div className="p-4">
          {!inf.hasData ? (
            <p className="text-slate-500 text-sm leading-relaxed text-center py-2">
              このエリアの詳細スコア（町域別）は順次対応予定です。
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] text-[#854F0B]/80">最高 取得スコア（推定）</span>
                <span className="text-xl font-black text-[#854F0B]">
                  {inf.topAcquisitionScore == null ? '—' : inf.topAcquisitionScore.toFixed(1)}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {(['S', 'A', 'B', 'C', 'D'] as const).map((r) => (
                  <span key={r} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ring-1 ${RANK_CHIP[r]}`}>
                    {r}
                    <span className="tabular-nums">{inf.rankCounts[r]}</span>
                  </span>
                ))}
              </div>
              <div className="text-[10px] text-slate-500">
                対象 {inf.townCount.toLocaleString('ja-JP')} 町域・基準月 {inf.asOf}
              </div>
              {inf.topReason && (
                <details>
                  <summary className="text-[10px] text-[#854F0B]/90 cursor-pointer hover:text-[#854F0B] select-none">
                    最高スコア町域の計算根拠（推定）を見る
                  </summary>
                  <p className="text-[10px] text-slate-500 mt-1 leading-relaxed whitespace-pre-wrap break-words">
                    {inf.topReason}
                  </p>
                </details>
              )}
            </div>
          )}
        </div>
        <p className="px-4 pb-3 text-[11px] text-slate-500 leading-relaxed">
          <Info className="inline w-3 h-3 mr-0.5 -mt-0.5" />
          推定スコア／ランクはルールベースの参考値です。物件の特定・売買の可否を断定するものではありません。
        </p>
      </section>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-900 font-semibold tabular-nums">{value}</span>
    </div>
  )
}

function GatedFallback() {
  return (
    <div className="bg-white border border-slate-200 rounded-xl py-16 px-6 text-center max-w-md mx-auto">
      <Lock className="w-10 h-10 text-brand-700 mx-auto mb-4" />
      <h2 className="text-lg font-bold mb-2">商圏レポートは Platinum 限定です</h2>
      <p className="text-slate-500 text-sm mb-6 leading-relaxed">
        選択した市区町村の商圏サマリを PDF 出力できる機能です。Platinum プランでご利用いただけます。
      </p>
      <div className="flex items-center justify-center gap-3">
        <Link href="/pricing" className="px-4 py-2 rounded-lg bg-brand-700 hover:bg-brand-500 text-white text-sm font-medium transition-colors">
          プランを見る
        </Link>
        <Link href="/dashboard" className="px-4 py-2 rounded-lg bg-white hover:bg-brand-100 border border-[#C7D6E4] text-brand-700 text-sm transition-colors">
          ダッシュボードへ戻る
        </Link>
      </div>
    </div>
  )
}

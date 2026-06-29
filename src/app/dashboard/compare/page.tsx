'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { MapPin, ArrowLeft, Scale, Sparkles, Info, Lock } from 'lucide-react'
import { useSubscription } from '@/hooks/useSubscription'
import { usePrefectures, useMunicipalities } from '@/hooks/useCensus'
import { PrefectureDropdown } from '@/components/ui/PrefectureDropdown'
import { canUse } from '@/lib/plans'
import { CENSUS, formatPopulation, formatDelta, formatRate } from '@/lib/census'

// ── /api/compare のレスポンス型（サーバーと対応） ──
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
interface AreaResult {
  id: string
  name: string
  prefectureCode: string | null
  confirmed: Confirmed
  inferred: Inferred
}
interface CompareResponse {
  a: AreaResult | null
  b: AreaResult | null
}

const RANK_CHIP: Record<string, string> = {
  S: 'bg-rose-500/20 text-rose-300 ring-rose-400/40',
  A: 'bg-amber-500/20 text-amber-300 ring-amber-400/40',
  B: 'bg-blue-500/20 text-blue-300 ring-blue-400/40',
  C: 'bg-slate-500/20 text-slate-300 ring-slate-400/30',
  D: 'bg-slate-600/20 text-slate-400 ring-slate-500/30',
}

export default function ComparePage() {
  const { plan } = useSubscription()
  const allowed = canUse(plan, 'areaCompare')
  const { prefectures } = usePrefectures()

  const [prefA, setPrefA] = useState('')
  const [muniA, setMuniA] = useState('')
  const [prefB, setPrefB] = useState('')
  const [muniB, setMuniB] = useState('')
  const [data, setData] = useState<CompareResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { municipalities: munisA } = useMunicipalities(prefA)
  const { municipalities: munisB } = useMunicipalities(prefB)

  useEffect(() => {
    if (!allowed || !muniA || !muniB) return
    let mounted = true
    // setState は await 後のコールバック内でのみ（effect 本体での同期 setState を避ける）。
    async function load() {
      try {
        const res = await fetch(`/api/compare?a=${encodeURIComponent(muniA)}&b=${encodeURIComponent(muniB)}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as CompareResponse
        if (mounted) {
          setData(json)
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
  }, [allowed, muniA, muniB])

  const bothSelected = !!(muniA && muniB)

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* ヘッダー */}
      <header className="bg-slate-800 border-b border-slate-700">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <MapPin className="w-4 h-4 text-white" />
            </div>
            <h1 className="flex items-center gap-2 font-bold text-base truncate">
              <Scale className="w-4 h-4 text-amber-400" />
              エリア比較
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-gradient-to-r from-amber-400 to-yellow-300 text-slate-900">
                <Sparkles className="w-3 h-3" /> Platinum
              </span>
            </h1>
          </div>
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">ダッシュボードへ戻る</span>
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {!allowed ? (
          <GatedFallback />
        ) : (
          <>
            {/* 2エリア選択 */}
            <div className="grid sm:grid-cols-2 gap-4 mb-6">
              <AreaSelector
                label="エリア A"
                prefectures={prefectures}
                prefCode={prefA}
                onPref={(c) => {
                  setPrefA(c)
                  setMuniA('')
                  setData(null)
                }}
                munis={munisA}
                muniId={muniA}
                onMuni={(id) => {
                  setMuniA(id)
                  setData(null)
                }}
              />
              <AreaSelector
                label="エリア B"
                prefectures={prefectures}
                prefCode={prefB}
                onPref={(c) => {
                  setPrefB(c)
                  setMuniB('')
                  setData(null)
                }}
                munis={munisB}
                muniId={muniB}
                onMuni={(id) => {
                  setMuniB(id)
                  setData(null)
                }}
              />
            </div>

            {!bothSelected && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl py-12 text-center text-slate-400 text-sm">
                比較する2つの市区町村を選択してください。
              </div>
            )}
            {bothSelected && error && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl py-12 text-center text-slate-400 text-sm">
                {error}
              </div>
            )}
            {bothSelected && !error && !data && (
              <div className="text-slate-500 text-sm py-12 text-center">読み込み中…</div>
            )}
            {bothSelected && !error && data && <Comparison a={data.a} b={data.b} />}
          </>
        )}
      </main>
    </div>
  )
}

function AreaSelector({
  label,
  prefectures,
  prefCode,
  onPref,
  munis,
  muniId,
  onMuni,
}: {
  label: string
  prefectures: { code: string; name: string }[]
  prefCode: string
  onPref: (code: string) => void
  munis: { id: string; name: string }[]
  muniId: string
  onMuni: (id: string) => void
}) {
  return (
    <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4">
      <div className="text-xs font-bold text-slate-300 mb-2">{label}</div>
      <div className="flex flex-col gap-2">
        <PrefectureDropdown
          prefectures={prefectures as never}
          selectedCode={prefCode}
          onSelect={onPref}
        />
        <select
          value={muniId}
          onChange={(e) => onMuni(e.target.value)}
          disabled={!prefCode || munis.length === 0}
          className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white text-sm px-3 py-2 disabled:opacity-50 focus:outline-none focus:border-blue-500"
        >
          <option value="">{prefCode ? '市区町村を選択' : '都道府県を先に選択'}</option>
          {munis.map((m) => (
            <option key={m.id} value={m.id} className="bg-slate-800">
              {m.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function Comparison({ a, b }: { a: AreaResult | null; b: AreaResult | null }) {
  return (
    <div className="space-y-6">
      {/* 確定セクション（青・両エリア対等） */}
      <section className="rounded-xl overflow-hidden border border-blue-500/30">
        <div className="bg-blue-500/10 border-l-4 border-blue-400 px-4 py-2">
          <h2 className="text-sm font-bold text-blue-200">確定（公表値・国勢調査）</h2>
          <p className="text-[11px] text-blue-300/70 mt-0.5">事実データ。両エリアを対等に比較します。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/80 text-slate-300">
                <th className="text-left font-medium px-4 py-2 w-2/5">指標</th>
                <th className="text-right font-bold px-4 py-2 text-white">{a?.name ?? '—'}</th>
                <th className="text-right font-bold px-4 py-2 text-white">{b?.name ?? '—'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/60">
              <Row label={`人口（${CENSUS.latestLabel}）`} av={a?.confirmed.popLatest} bv={b?.confirmed.popLatest} fmt={formatPopulation} />
              <Row label={`人口（${CENSUS.prevLabel}）`} av={a?.confirmed.popPrev} bv={b?.confirmed.popPrev} fmt={formatPopulation} />
              <Row label={`人口（${CENSUS.prev2Label}）`} av={a?.confirmed.popPrev2} bv={b?.confirmed.popPrev2} fmt={formatPopulation} />
              <Row label={`世帯数（${CENSUS.latestLabel}）`} av={a?.confirmed.householdsLatest} bv={b?.confirmed.householdsLatest} fmt={(v) => (v == null ? '—' : `${v.toLocaleString('ja-JP')}世帯`)} />
              <Row label={`人口増減数（${CENSUS.deltaRangeLabel}）`} av={a?.confirmed.delta} bv={b?.confirmed.delta} fmt={formatDelta} />
              <Row label={`人口増減率（${CENSUS.deltaRangeLabel}）`} av={a?.confirmed.deltaRate} bv={b?.confirmed.deltaRate} fmt={formatRate} />
              <Row label="駅乗降客数（合計・最新）" av={a?.confirmed.stationPassengersTotal ?? null} bv={b?.confirmed.stationPassengersTotal ?? null} fmt={(v) => (v == null ? '—' : `${v.toLocaleString('ja-JP')}人/日`)} />
            </tbody>
          </table>
        </div>
      </section>

      {/* 推定セクション（橙・推定バッジ・岩国のみデータ） */}
      <section className="rounded-xl overflow-hidden border border-amber-500/30">
        <div className="bg-amber-500/10 border-l-4 border-amber-400 px-4 py-2 flex items-center gap-2">
          <h2 className="text-sm font-bold text-amber-200">推定（町域スコア集計・ルールベース）</h2>
          <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-amber-400/20 text-amber-300 ring-1 ring-amber-400/40">
            推定
          </span>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 p-3">
          <InferredCard area={a} />
          <InferredCard area={b} />
        </div>
        <p className="px-4 pb-3 text-[11px] text-slate-500 leading-relaxed">
          <Info className="inline w-3 h-3 mr-0.5 -mt-0.5" />
          推定スコア／ランクはルールベースの参考値です。物件の特定・売買の可否を断定するものではありません。
        </p>
      </section>
    </div>
  )
}

function Row({
  label,
  av,
  bv,
  fmt,
}: {
  label: string
  av: number | null | undefined
  bv: number | null | undefined
  fmt: (v: number | null) => string
}) {
  const a = av ?? null
  const b = bv ?? null
  // 大きい側を強調（確定値の比較。両方数値のときのみ）。
  const aBig = a != null && b != null && a > b
  const bBig = a != null && b != null && b > a
  return (
    <tr>
      <td className="px-4 py-2 text-slate-400">{label}</td>
      <td className={`px-4 py-2 text-right tabular-nums ${aBig ? 'text-white font-bold' : 'text-slate-200'}`}>{fmt(a)}</td>
      <td className={`px-4 py-2 text-right tabular-nums ${bBig ? 'text-white font-bold' : 'text-slate-200'}`}>{fmt(b)}</td>
    </tr>
  )
}

function InferredCard({ area }: { area: AreaResult | null }) {
  const inf = area?.inferred
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-3">
      <div className="text-sm font-bold text-white mb-2 truncate">{area?.name ?? '—'}</div>

      {!inf || !inf.hasData ? (
        // 「データなし」をエラーにせず、前向き・中立な文言で（他社デモで製品が壊れて見えないように）。
        <div className="rounded-lg bg-slate-700/30 px-3 py-4 text-center">
          <p className="text-slate-400 text-xs leading-relaxed">
            このエリアの詳細スコア（町域別）は順次対応予定です。
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] text-amber-300/80">最高 取得スコア（推定）</span>
            <span className="text-xl font-black text-amber-300">
              {inf.topAcquisitionScore == null ? '—' : inf.topAcquisitionScore.toFixed(1)}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {(['S', 'A', 'B', 'C', 'D'] as const).map((r) => (
              <span
                key={r}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ring-1 ${RANK_CHIP[r]}`}
              >
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
              <summary className="text-[10px] text-amber-300/80 cursor-pointer hover:text-amber-200 select-none">
                最高スコア町域の計算根拠（推定）を見る
              </summary>
              <p className="text-[10px] text-slate-400 mt-1 leading-relaxed whitespace-pre-wrap break-words">
                {inf.topReason}
              </p>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

function GatedFallback() {
  return (
    <div className="bg-slate-800/60 border border-slate-700 rounded-xl py-16 px-6 text-center max-w-md mx-auto">
      <Lock className="w-10 h-10 text-amber-400 mx-auto mb-4" />
      <h2 className="text-lg font-bold mb-2">エリア比較は Platinum 限定です</h2>
      <p className="text-slate-400 text-sm mb-6 leading-relaxed">
        2つの市区町村を並べて比較できる機能です。Platinum プランでご利用いただけます。
      </p>
      <div className="flex items-center justify-center gap-3">
        <Link href="/pricing" className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors">
          プランを見る
        </Link>
        <Link href="/dashboard" className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm transition-colors">
          ダッシュボードへ戻る
        </Link>
      </div>
    </div>
  )
}

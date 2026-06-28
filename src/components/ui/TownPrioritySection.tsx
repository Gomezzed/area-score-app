'use client'

import { useEffect, useState } from 'react'
import { Target, Sparkles, Info, TrendingUp, TrendingDown } from 'lucide-react'
import { useSubscription } from '@/hooks/useSubscription'
import { canUse } from '@/lib/plans'

// デモは岩国市(muni_code=352080)のみ public.town_monthly_metrics に実データ投入済み。
// 将来は詳細パネルで選択中エリアの muni_code を渡して連動させる（暫定ハードコードは最小限）。
const DEMO_MUNI_CODE = '352080'
// 側パネルに収めるため上位 N 件のみ表示（全件数は注記で示す）。
const MAX_VISIBLE = 10

interface TownItem {
  townId: number
  townName: string
  officeName: string | null
  asOf: string
  confirmed: {
    households: number | null
    population: number | null
    householdsYoyDelta: number | null
    populationYoyDelta: number | null
  }
  inferred: {
    demandScore: number | null
    sellSignalScore: number | null
    supplyEventScore: number | null
    acquisitionScore: number | null
    priorityRank: string | null
    reason: string | null
  }
}

interface TownResponse {
  muniCode: string
  asOf: string | null
  items: TownItem[]
}

// 取得優先ランク(S/A/B/C/D)のバッジ配色。S/A を強調。
const RANK_STYLE: Record<string, string> = {
  S: 'bg-rose-500 text-white ring-2 ring-rose-300/50',
  A: 'bg-amber-500 text-white ring-2 ring-amber-300/40',
  B: 'bg-blue-500 text-white',
  C: 'bg-slate-500 text-white',
  D: 'bg-slate-600 text-slate-300',
}

const fmtScore = (v: number | null): string => (v == null ? '—' : v.toFixed(1))
const fmtInt = (v: number | null): string => (v == null ? '—' : v.toLocaleString('ja-JP'))

// 町域別 仕入れ優先度（Platinum 専用）。
//   表示可否は canUse(plan,'townAcquisitionPriority') でゲート（plan 直書き禁止・T1 と同一定義）。
//   非platinum はセクションごと非表示（=パネルに何も出さない）。
export function TownPrioritySection({ muniCode = DEMO_MUNI_CODE }: { muniCode?: string }) {
  const { plan } = useSubscription()
  const allowed = canUse(plan, 'townAcquisitionPriority')

  const [data, setData] = useState<TownResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!allowed) return
    let mounted = true
    // setState は await 後のコールバック内でのみ行う（effect 本体での同期 setState を避ける）。
    // loading は初期値 true。デモは muniCode 固定のため再フェッチ時のリセットは不要。
    async function load() {
      try {
        const res = await fetch(`/api/towns?muni_code=${encodeURIComponent(muniCode)}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as TownResponse
        if (mounted) {
          setData(json)
          setError(null)
          setLoading(false)
        }
      } catch {
        if (mounted) {
          setError('読み込みに失敗しました')
          setLoading(false)
        }
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [allowed, muniCode])

  // 非platinum はセクション非表示（パネル非表示要件）。
  if (!allowed) return null

  const items = data?.items ?? []
  const visible = items.slice(0, MAX_VISIBLE)

  return (
    <div className="mt-6 border-t border-slate-700 pt-5">
      <h3 className="flex flex-wrap items-center gap-2 text-sm font-bold text-white mb-1">
        <Target className="w-4 h-4 text-amber-400" />
        町域別 仕入れ優先度
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-gradient-to-r from-amber-400 to-yellow-300 text-slate-900">
          <Sparkles className="w-3 h-3" /> Platinum
        </span>
      </h3>
      <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">
        岩国市（デモ）{data?.asOf ? ` ・基準月 ${data.asOf}` : ''}。
        確定値（公表事実）と推定スコア（ルールベース参考値）を分けて表示します。
      </p>

      {loading && <div className="text-slate-500 text-sm py-6 text-center">読み込み中…</div>}

      {!loading && error && (
        <div className="bg-slate-700/30 rounded-lg py-6 text-center text-slate-500 text-sm">{error}</div>
      )}

      {!loading && !error && visible.length === 0 && (
        <div className="bg-slate-700/30 rounded-lg py-6 text-center text-slate-500 text-sm">
          対象データがありません
        </div>
      )}

      {!loading && !error && visible.length > 0 && (
        <>
          <div className="space-y-3">
            {visible.map((t) => (
              <TownCard key={t.townId} t={t} />
            ))}
          </div>

          {items.length > visible.length && (
            <p className="text-[11px] text-slate-500 mt-3 text-center">
              全 {items.length.toLocaleString('ja-JP')} 町域中 上位 {visible.length} 件を表示（取得スコア順）
            </p>
          )}

          <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
            <Info className="inline w-3 h-3 mr-0.5 -mt-0.5" />
            推定スコア／ランクはルールベースの参考値です。物件の特定・売買の可否を断定するものではありません。
          </p>
        </>
      )}
    </div>
  )
}

function TownCard({ t }: { t: TownItem }) {
  const rank = t.inferred.priorityRank ?? '—'
  const rankStyle = RANK_STYLE[rank] ?? 'bg-slate-600 text-slate-300'
  const emphasized = rank === 'S' || rank === 'A'

  return (
    <div
      className={`rounded-xl overflow-hidden border ${
        emphasized ? 'border-amber-500/40' : 'border-slate-700'
      } bg-slate-800/60`}
    >
      {/* ヘッダー: ランク + 町名(+出張所) + 取得スコア */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-700/40">
        <span className={`flex items-center justify-center w-7 h-7 rounded-lg text-sm font-black ${rankStyle}`}>
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-white truncate">{t.townName}</div>
          {t.officeName && <div className="text-[10px] text-slate-400 truncate">{t.officeName}</div>}
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[10px] text-amber-300/70 leading-none">推定 取得スコア</div>
          <div className="text-base font-black text-amber-300 leading-tight">
            {fmtScore(t.inferred.acquisitionScore)}
          </div>
        </div>
      </div>

      {/* 確定（事実）— 青帯。バッジなし（公表値そのもの） */}
      <div className="px-3 py-2 border-l-4 border-blue-400">
        <div className="text-[10px] font-bold text-blue-300 mb-1">確定（公表値・事実 / 増減は前年比）</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <Fact label="世帯数" value={fmtInt(t.confirmed.households)} delta={t.confirmed.householdsYoyDelta} />
          <Fact label="人口" value={fmtInt(t.confirmed.population)} delta={t.confirmed.populationYoyDelta} />
        </div>
      </div>

      {/* 推定（参考値）— 橙帯。必ず「推定」バッジ + 計算根拠(reason) */}
      <div className="px-3 py-2 border-l-4 border-amber-400 bg-amber-500/5">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[10px] font-bold text-amber-300">推定（ルールベース）</span>
          <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-amber-400/20 text-amber-300 ring-1 ring-amber-400/40">
            推定
          </span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-300">
          <span>需要 <b className="text-white">{fmtScore(t.inferred.demandScore)}</b></span>
          <span>売却 <b className="text-white">{fmtScore(t.inferred.sellSignalScore)}</b></span>
          <span>供給 <b className="text-white">{fmtScore(t.inferred.supplyEventScore)}</b></span>
        </div>
        {t.inferred.reason && (
          <details className="mt-1.5">
            <summary className="text-[10px] text-amber-300/80 cursor-pointer hover:text-amber-200 select-none">
              計算根拠（推定）を見る
            </summary>
            <p className="text-[10px] text-slate-400 mt-1 leading-relaxed whitespace-pre-wrap break-words">
              {t.inferred.reason}
            </p>
          </details>
        )}
      </div>
    </div>
  )
}

function Fact({ label, value, delta }: { label: string; value: string; delta: number | null }) {
  const pos = (delta ?? 0) >= 0
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-400">{label}</span>
      <span className="text-white font-semibold inline-flex items-center">
        {value}
        {delta != null && (
          <span className={`ml-1 inline-flex items-center text-[10px] ${pos ? 'text-blue-400' : 'text-red-400'}`}>
            {pos ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {pos ? '+' : ''}
            {delta.toLocaleString('ja-JP')}
          </span>
        )}
      </span>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import {
  X, Trophy, Sparkles, Info, TrendingUp, TrendingDown, ArrowUp, ArrowDown, Minus, Clock,
} from 'lucide-react'
import { useSubscription } from '@/hooks/useSubscription'
import { canUse } from '@/lib/plans'
import { toMuniCode6 } from '@/lib/muni-code'

type RankChange = 'up' | 'down' | 'same' | 'new' | null

interface HighlightItem {
  position: number
  townId: number
  townName: string
  officeName: string | null
  asOf: string
  confirmed: {
    householdsYoyDelta: number | null
    populationYoyDelta: number | null
  }
  inferred: {
    priorityRank: string | null
    acquisitionScore: number | null
    demandScore: number | null
    sellSignalScore: number | null
    supplyEventScore: number | null
    reason: string | null
    rankChange: RankChange
  }
}

interface HighlightsResponse {
  available: boolean
  muniCode: string
  asOf: string | null
  prevAsOf: string | null
  items: HighlightItem[]
}

// 取得優先ランク(S/A/B/C/D)のバッジ配色。S/A を強調。
const RANK_STYLE: Record<string, string> = {
  S: 'bg-rose-500 text-white ring-2 ring-rose-300/50',
  A: 'bg-amber-500 text-white ring-2 ring-amber-300/40',
  B: 'bg-blue-500 text-white',
  C: 'bg-slate-500 text-white',
  D: 'bg-slate-200 text-slate-600',
}

const fmtScore = (v: number | null): string => (v == null ? '—' : v.toFixed(1))

// 詳細パネルと同じ absolute スライドオーバー方式。flex レイアウトに干渉しない。
//   表示可否は canUse(plan,'townAcquisitionPriority') で自己ゲート（非platinum は描画ゼロ）。
export function TownHighlightsPanel({
  open,
  onClose,
  cityCode,
  muniName,
}: {
  open: boolean
  onClose: () => void
  cityCode?: string | null
  muniName?: string | null
}) {
  const { plan } = useSubscription()
  const allowed = canUse(plan, 'townAcquisitionPriority')

  // 5桁 JIS → 6桁（JIS X 0402 検査数字付与）。不正/欠損は null（＝準備中扱い）。
  const muniCode6 = toMuniCode6(cityCode)

  // フェッチ結果は「どの muniCode6 のものか」を併せて保持する（切替時の古いデータ排除＋
  //   effect 本体での同期 setState 回避。setState は全て await 後に行う）。
  const [result, setResult] = useState<
    { code: string; data: HighlightsResponse | null; failed: boolean } | null
  >(null)

  useEffect(() => {
    if (!allowed || !open || !muniCode6) return
    const code = muniCode6
    let mounted = true
    // 選択中市区町村が変わるたび再取得（依存配列に muniCode6）。
    async function load() {
      try {
        const res = await fetch(`/api/towns/highlights?muni_code=${encodeURIComponent(code)}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as HighlightsResponse
        if (mounted) setResult({ code, data: json, failed: false })
      } catch {
        if (mounted) setResult({ code, data: null, failed: true })
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [allowed, open, muniCode6])

  // 非platinum はパネルごと非表示（描画しない）。
  if (!allowed) return null

  // 現在の選択コードに一致する結果のみ採用（切替直後の古いデータを排除）。
  const matched = result && result.code === muniCode6 ? result : null
  const data = matched?.data ?? null
  const error = matched?.failed ?? false
  const loading = !!muniCode6 && matched == null
  const items = data?.items ?? []
  // 準備中: コード不正/未選択、または API が available:false（当該自治体に実データ無し）。
  const notReady = !muniCode6 || (!loading && !error && data != null && data.available === false)

  return (
    <div
      className={`absolute inset-y-0 right-0 w-full md:w-[28rem] bg-white border-l border-slate-200 shadow-xl z-[1200] overflow-y-auto transition-transform duration-300 ease-out ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
      aria-hidden={!open}
    >
      <div className="p-5">
        {/* ヘッダー */}
        <div className="flex items-start justify-between mb-2">
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold text-slate-900 leading-tight">
            <Trophy className="w-5 h-5 text-brand-700" />
            注目町域 TOP20
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#FAEEDA] text-[#854F0B]">
              <Sparkles className="w-3 h-3" /> Platinum
            </span>
          </h2>
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="flex items-center justify-center min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 -mr-2 md:mr-0 text-slate-400 hover:text-slate-900 transition-colors md:p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-[11px] text-slate-500 mb-4 leading-relaxed">
          {muniName ? `${muniName}` : '選択中の市区町村'}
          {data?.available && data?.asOf ? ` ・基準月 ${data.asOf}` : ''}。
          取得優先ランク（S→A→B→C→D）と取得スコア順の上位20町域。確定値（公表事実）と推定スコア（ルールベース参考値）を分けて表示します。
        </p>

        {!notReady && loading && (
          <div className="text-slate-500 text-sm py-8 text-center">読み込み中…</div>
        )}

        {!notReady && !loading && error && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg py-8 text-center text-slate-500 text-sm">
            読み込みに失敗しました
          </div>
        )}

        {notReady && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg py-8 px-4 text-center">
            <Clock className="w-7 h-7 text-slate-400 mx-auto mb-2" />
            <p className="text-slate-500 text-sm font-medium">
              {muniName ? `${muniName} の町域別データは現在準備中です` : '町域別データは現在準備中です'}
            </p>
            <p className="text-slate-500 text-[11px] mt-1">対応自治体から順次拡大しています。</p>
          </div>
        )}

        {!notReady && !loading && !error && items.length > 0 && (
          <>
            <div className="space-y-2.5">
              {items.map((t) => (
                <HighlightRow key={t.townId} t={t} hasPrev={data?.prevAsOf != null} />
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-4 leading-relaxed">
              <Info className="inline w-3 h-3 mr-0.5 -mt-0.5" />
              推定スコア／ランク（および前月比）はルールベースの参考値です。物件の特定・売買の可否を断定するものではありません。
              {data?.prevAsOf ? ` 前月比は ${data.prevAsOf} 比。` : ''}
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function HighlightRow({ t, hasPrev }: { t: HighlightItem; hasPrev: boolean }) {
  const rank = t.inferred.priorityRank ?? '—'
  const rankStyle = RANK_STYLE[rank] ?? 'bg-slate-200 text-slate-600'
  const emphasized = rank === 'S' || rank === 'A'

  return (
    <div
      className={`rounded-xl overflow-hidden border ${
        emphasized ? 'border-amber-300' : 'border-slate-200'
      } bg-slate-50`}
    >
      {/* ヘッダー: 順位 + ランク + 町名 + 前月比 + 取得スコア */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-slate-200">
        <span className="text-xs font-mono text-slate-400 w-6 text-right flex-shrink-0">
          #{t.position}
        </span>
        <span className={`flex items-center justify-center w-7 h-7 rounded-lg text-sm font-black flex-shrink-0 ${rankStyle}`}>
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-slate-900 truncate">{t.townName}</div>
          {t.officeName && <div className="text-[10px] text-slate-400 truncate">{t.officeName}</div>}
        </div>
        {hasPrev && <RankTrend change={t.inferred.rankChange} />}
        <div className="text-right flex-shrink-0">
          <div className="text-[10px] text-[#854F0B]/80 leading-none">推定 取得</div>
          <div className="text-base font-black text-[#854F0B] leading-tight">
            {fmtScore(t.inferred.acquisitionScore)}
          </div>
        </div>
      </div>

      {/* 確定（事実）— 青帯。前年比のみ */}
      <div className="px-3 py-1.5 border-l-4 border-brand-700 bg-white">
        <div className="flex items-center gap-3 text-[11px]">
          <span className="text-[10px] font-bold text-brand-700">確定（前年比）</span>
          <Yoy label="世帯" delta={t.confirmed.householdsYoyDelta} />
          <Yoy label="人口" delta={t.confirmed.populationYoyDelta} />
        </div>
      </div>

      {/* 推定（参考値）— 橙帯。必ず「推定」バッジ + 計算根拠(reason) */}
      <div className="px-3 py-1.5 border-l-4 border-amber-400 bg-[#FAEEDA]/40">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
          <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-[#FAEEDA] text-[#854F0B] ring-1 ring-amber-300">
            推定
          </span>
          <span>需要 <b className="text-slate-900">{fmtScore(t.inferred.demandScore)}</b></span>
          <span>売却 <b className="text-slate-900">{fmtScore(t.inferred.sellSignalScore)}</b></span>
          <span>供給 <b className="text-slate-900">{fmtScore(t.inferred.supplyEventScore)}</b></span>
        </div>
        {t.inferred.reason && (
          <details className="mt-1">
            <summary className="text-[10px] text-[#854F0B]/90 cursor-pointer hover:text-[#854F0B] select-none">
              計算根拠（推定）を見る
            </summary>
            <p className="text-[10px] text-slate-500 mt-1 leading-relaxed whitespace-pre-wrap break-words">
              {t.inferred.reason}
            </p>
          </details>
        )}
      </div>
    </div>
  )
}

// 確定値の前年比（事実）。バッジは付けない。
function Yoy({ label, delta }: { label: string; delta: number | null }) {
  const pos = (delta ?? 0) >= 0
  return (
    <span className="inline-flex items-center gap-0.5 text-slate-500">
      <span className="text-slate-500">{label}</span>
      {delta == null ? (
        <span className="text-slate-500">—</span>
      ) : (
        <span className={`inline-flex items-center ${pos ? 'text-delta-up' : 'text-delta-down'}`}>
          {pos ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {pos ? '+' : ''}
          {delta.toLocaleString('ja-JP')}
        </span>
      )}
    </span>
  )
}

// 推定ランクの前月比トレンド（推定由来であることを title に明示）。
function RankTrend({ change }: { change: RankChange }) {
  if (change == null) return null
  if (change === 'new') {
    return (
      <span
        title="前月データに無い新規（推定ランク）"
        className="px-1 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 flex-shrink-0"
      >
        NEW
      </span>
    )
  }
  const map = {
    up: { icon: <ArrowUp className="w-3.5 h-3.5" />, cls: 'text-emerald-600', title: '推定ランク 上昇（前月比）' },
    down: { icon: <ArrowDown className="w-3.5 h-3.5" />, cls: 'text-rose-600', title: '推定ランク 下降（前月比）' },
    same: { icon: <Minus className="w-3.5 h-3.5" />, cls: 'text-slate-500', title: '推定ランク 横ばい（前月比）' },
  }[change]
  return (
    <span title={map.title} className={`flex-shrink-0 ${map.cls}`}>
      {map.icon}
    </span>
  )
}

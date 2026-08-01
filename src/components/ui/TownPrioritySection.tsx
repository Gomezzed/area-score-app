'use client'

import { useEffect, useState } from 'react'
import { Target, Sparkles, Info, TrendingUp, TrendingDown, Clock } from 'lucide-react'
import { useSubscription } from '@/hooks/useSubscription'
import { canUse } from '@/lib/plans'
import { toMuniCode6 } from '@/lib/muni-code'

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
  available: boolean
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
  D: 'bg-slate-200 text-slate-600',
}

const fmtScore = (v: number | null): string => (v == null ? '—' : v.toFixed(1))
const fmtInt = (v: number | null): string => (v == null ? '—' : v.toLocaleString('ja-JP'))

// 町域別 仕入れ優先度（Platinum 専用）。
//   表示可否は canUse(plan,'townAcquisitionPriority') でゲート（plan 直書き禁止・T1 と同一定義）。
//   非platinum はセクションごと非表示（=パネルに何も出さない）。
//   対象自治体は「選択中市区町村の city_code(5桁JIS)」を 6桁へ正規化して API に渡し、
//   実データの有無（available）だけで出し分ける。対応自治体のハードコードは持たない。
export function TownPrioritySection({
  cityCode,
  muniName,
}: {
  cityCode?: string | null
  muniName?: string | null
}) {
  const { plan } = useSubscription()
  const allowed = canUse(plan, 'townAcquisitionPriority')

  // 5桁 JIS → 6桁（JIS X 0402 検査数字付与）。不正/欠損は null（＝準備中扱い）。
  const muniCode6 = toMuniCode6(cityCode)

  // フェッチ結果は「どの muniCode6 のものか」を併せて保持する。
  //   こうすると選択切替時に古いデータを表示しないよう派生でき、
  //   effect 本体での同期 setState（カスケード再レンダ）を避けられる（全て await 後に setState）。
  const [result, setResult] = useState<
    { code: string; data: TownResponse | null; failed: boolean } | null
  >(null)

  useEffect(() => {
    if (!allowed || !muniCode6) return
    const code = muniCode6
    let mounted = true
    // 選択中市区町村が変わるたび再取得（依存配列に muniCode6）。
    async function load() {
      try {
        const res = await fetch(`/api/towns?muni_code=${encodeURIComponent(code)}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as TownResponse
        if (mounted) setResult({ code, data: json, failed: false })
      } catch {
        if (mounted) setResult({ code, data: null, failed: true })
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [allowed, muniCode6])

  // 非platinum はセクション非表示（パネル非表示要件）。
  if (!allowed) return null

  // 現在の選択コードに一致する結果のみ採用（切替直後の古いデータを排除）。
  const matched = result && result.code === muniCode6 ? result : null
  const data = matched?.data ?? null
  const error = matched?.failed ?? false
  const loading = !!muniCode6 && matched == null // 当該コードの取得が未完了
  const items = data?.items ?? []
  const visible = items.slice(0, MAX_VISIBLE)
  // 準備中: コード不正/未選択、または API が available:false（当該自治体に実データ無し）。
  const notReady = !muniCode6 || (!loading && !error && data != null && data.available === false)

  return (
    <div className="mt-6 border-t border-slate-200 pt-5">
      <h3 className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900 mb-1">
        <Target className="w-4 h-4 text-brand-700" />
        町域別 仕入れ優先度
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#FAEEDA] text-[#854F0B]">
          <Sparkles className="w-3 h-3" /> Platinum
        </span>
      </h3>
      <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">
        {muniName ? `${muniName}` : '選択中の市区町村'}
        {data?.available && data?.asOf ? ` ・基準月 ${data.asOf}` : ''}。
        確定値（公表事実）と推定スコア（ルールベース参考値）を分けて表示します。
      </p>

      {!notReady && loading && (
        <div className="text-slate-500 text-sm py-6 text-center">読み込み中…</div>
      )}

      {!notReady && !loading && error && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg py-6 text-center text-slate-500 text-sm">
          読み込みに失敗しました
        </div>
      )}

      {notReady && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg py-6 px-4 text-center">
          <Clock className="w-6 h-6 text-slate-400 mx-auto mb-2" />
          <p className="text-slate-500 text-sm font-medium">
            {muniName ? `${muniName} の町域別データは現在準備中です` : '町域別データは現在準備中です'}
          </p>
          <p className="text-slate-500 text-[11px] mt-1">対応自治体から順次拡大しています。</p>
        </div>
      )}

      {!notReady && !loading && !error && visible.length > 0 && (
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
  const rankStyle = RANK_STYLE[rank] ?? 'bg-slate-200 text-slate-600'
  const emphasized = rank === 'S' || rank === 'A'

  return (
    <div
      className={`rounded-xl overflow-hidden border ${
        emphasized ? 'border-amber-300' : 'border-slate-200'
      } bg-slate-50`}
    >
      {/* ヘッダー: ランク + 町名(+出張所) + 取得スコア */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-slate-200">
        <span className={`flex items-center justify-center w-7 h-7 rounded-lg text-sm font-black ${rankStyle}`}>
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-slate-900 truncate">{t.townName}</div>
          {t.officeName && <div className="text-[10px] text-slate-400 truncate">{t.officeName}</div>}
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[10px] text-[#854F0B]/80 leading-none">推定 取得スコア</div>
          <div className="text-base font-black text-[#854F0B] leading-tight">
            {fmtScore(t.inferred.acquisitionScore)}
          </div>
        </div>
      </div>

      {/* 確定（事実）— 青帯。バッジなし（公表値そのもの） */}
      <div className="px-3 py-2 border-l-4 border-brand-700 bg-white">
        <div className="text-[10px] font-bold text-brand-700 mb-1">確定（公表値・事実 / 増減は前年比）</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <Fact label="世帯数" value={fmtInt(t.confirmed.households)} delta={t.confirmed.householdsYoyDelta} />
          <Fact label="人口" value={fmtInt(t.confirmed.population)} delta={t.confirmed.populationYoyDelta} />
        </div>
      </div>

      {/* 推定（参考値）— 橙帯。必ず「推定」バッジ + 計算根拠(reason) */}
      <div className="px-3 py-2 border-l-4 border-amber-400 bg-[#FAEEDA]/40">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[10px] font-bold text-[#854F0B]">推定（ルールベース）</span>
          <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-[#FAEEDA] text-[#854F0B] ring-1 ring-amber-300">
            推定
          </span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
          <span>需要 <b className="text-slate-900">{fmtScore(t.inferred.demandScore)}</b></span>
          <span>売却 <b className="text-slate-900">{fmtScore(t.inferred.sellSignalScore)}</b></span>
          <span>供給 <b className="text-slate-900">{fmtScore(t.inferred.supplyEventScore)}</b></span>
        </div>
        {t.inferred.reason && (
          <details className="mt-1.5">
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

function Fact({ label, value, delta }: { label: string; value: string; delta: number | null }) {
  const pos = (delta ?? 0) >= 0
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-900 font-semibold inline-flex items-center">
        {value}
        {delta != null && (
          <span className={`ml-1 inline-flex items-center text-[10px] ${pos ? 'text-delta-up' : 'text-delta-down'}`}>
            {pos ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {pos ? '+' : ''}
            {delta.toLocaleString('ja-JP')}
          </span>
        )}
      </span>
    </div>
  )
}

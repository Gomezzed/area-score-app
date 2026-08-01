'use client'

import { useEffect, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { Landmark, Coins } from 'lucide-react'
import { useSubscription } from '@/hooks/useSubscription'
import { usePlanLimit } from '@/hooks/usePlanLimit'

interface MetricRow {
  metricType: string
  propertyType: string
  year: number
  quarter: number | null
  value: number | null
  unit: string
  sampleCount: number | null
}

interface MarketMetricsResponse {
  muniCode: string
  confirmed: MetricRow[]
  reference: MetricRow[]
}

const MUNI_CODE_RE = /^[0-9]{5}$/

const TOOLTIP_STYLE = {
  backgroundColor: '#1e293b',
  border: '1px solid #475569',
  borderRadius: '0.5rem',
  fontSize: '12px',
}

// Y軸目盛り: 10000 以上は「万」単位に変換
const formatMan = (v: number): string =>
  v >= 10000
    ? `${(v / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}万`
    : v.toLocaleString('ja-JP')

// ── 公示価格（確定・official_land_price）: 住宅地・商業地の2種のみ表示 ──
const LAND_TYPES = ['住宅地', '商業地'] as const
type LandType = (typeof LAND_TYPES)[number]

interface LandPoint {
  year: number
  values: Partial<Record<LandType, number>>
}

function buildLandSeries(rows: MetricRow[]): LandPoint[] {
  const byYear = new Map<number, Partial<Record<LandType, number>>>()
  for (const r of rows) {
    if (r.value == null) continue
    if (!(LAND_TYPES as readonly string[]).includes(r.propertyType)) continue
    const entry = byYear.get(r.year) ?? {}
    entry[r.propertyType as LandType] = r.value
    byYear.set(r.year, entry)
  }
  return Array.from(byYear.entries())
    .map(([year, values]) => ({ year, values }))
    .sort((a, b) => a.year - b.year)
}

// ── 取引価格中央値（参考・trade_price）: 中古マンション等/宅地(土地)/宅地(土地と建物) のみ表示。
//    農地・林地はDBには保持するがUIでは表示しない（D7）。
const TRADE_TYPES = ['中古マンション等', '宅地(土地)', '宅地(土地と建物)'] as const
type TradeType = (typeof TRADE_TYPES)[number]

interface TradePoint {
  key: string
  year: number
  quarter: number
  values: Partial<Record<TradeType, number>>
}

interface TradeLatestEntry {
  value: number
  sampleCount: number | null
  year: number
  quarter: number
}

function buildTradeSeries(rows: MetricRow[]): TradePoint[] {
  const byPeriod = new Map<string, TradePoint>()
  for (const r of rows) {
    if (r.value == null || r.quarter == null) continue
    if (!(TRADE_TYPES as readonly string[]).includes(r.propertyType)) continue
    const key = `${r.year}Q${r.quarter}`
    const entry = byPeriod.get(key) ?? { key, year: r.year, quarter: r.quarter, values: {} }
    entry.values[r.propertyType as TradeType] = r.value
    byPeriod.set(key, entry)
  }
  return Array.from(byPeriod.values()).sort((a, b) => a.year - b.year || a.quarter - b.quarter)
}

function buildTradeLatest(rows: MetricRow[]): Partial<Record<TradeType, TradeLatestEntry>> {
  const latest: Partial<Record<TradeType, TradeLatestEntry>> = {}
  for (const r of rows) {
    if (r.value == null || r.quarter == null) continue
    if (!(TRADE_TYPES as readonly string[]).includes(r.propertyType)) continue
    const type = r.propertyType as TradeType
    const cur = latest[type]
    if (!cur || r.year > cur.year || (r.year === cur.year && r.quarter > cur.quarter)) {
      latest[type] = { value: r.value, sampleCount: r.sampleCount, year: r.year, quarter: r.quarter }
    }
  }
  return latest
}

// 相場・公示価格セクション（Standard 以上）。
//   表示可否 = usePlanLimit(plan).marketMetricsEnabled
//   （= 権限 marketMetricsEntitled AND マスターフラグ NEXT_PUBLIC_FEATURE_MARKET_METRICS。
//    駅単位ドリルダウンと同じAND設計。評価は usePlanLimit に一本化）。
//   条件未達（free/starter またはフラグ off）はセクションごと非表示。
//   確定(公示価格)と参考(取引価格中央値)は互いに0件でも独立して出し分ける
//   （データ未着の間はそのブロックの見出しごと自然に省略）。
export function MarketMetricsSection({ muniCode }: { muniCode: string | null }) {
  const { plan } = useSubscription()
  const { marketMetricsEnabled: allowed } = usePlanLimit(plan)
  const validCode = muniCode && MUNI_CODE_RE.test(muniCode) ? muniCode : null

  const [result, setResult] = useState<
    { code: string; data: MarketMetricsResponse | null; failed: boolean } | null
  >(null)

  useEffect(() => {
    if (!allowed || !validCode) return
    const code = validCode
    let mounted = true
    // setState は await 後のコールバック内でのみ行う（effect 本体での同期 setState を避ける）。
    async function load() {
      try {
        const res = await fetch(`/api/market-metrics?muni_code=${encodeURIComponent(code)}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as MarketMetricsResponse
        if (mounted) setResult({ code, data: json, failed: false })
      } catch {
        if (mounted) setResult({ code, data: null, failed: true })
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [allowed, validCode])

  // 権限なし / フラグ off / muni_code不明は非表示。
  if (!allowed || !validCode) return null

  // 現在の選択コードに一致する結果のみ採用（切替直後の古いデータを排除）。
  const matched = result && result.code === validCode ? result : null
  const loading = matched == null
  const error = matched?.failed ?? false
  const data = matched?.data ?? null

  if (loading || error) {
    return (
      <div className="mt-6 border-t border-slate-200 pt-5">
        {loading && <div className="text-slate-500 text-sm py-4 text-center">相場データ読み込み中…</div>}
        {!loading && error && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg py-4 text-center text-slate-500 text-sm">
            相場データの読み込みに失敗しました
          </div>
        )}
      </div>
    )
  }

  const landSeries = buildLandSeries(data?.confirmed ?? [])
  const tradeSeries = buildTradeSeries(data?.reference ?? [])
  const tradeLatest = buildTradeLatest(data?.reference ?? [])
  const hasLand = landSeries.length > 0
  const hasTrade = tradeSeries.length > 0

  // 双方0件（データ未着）はセクションごと自然に省略。
  if (!hasLand && !hasTrade) return null

  return (
    <>
      {hasLand && <LandPriceBlock series={landSeries} />}
      {hasTrade && <TradePriceBlock series={tradeSeries} latest={tradeLatest} />}
      <p className="text-slate-500 text-[11px] mt-2 leading-relaxed">
        出典: 国土交通省 不動産情報ライブラリ
      </p>
    </>
  )
}

function LandPriceBlock({ series }: { series: LandPoint[] }) {
  const latest = series[series.length - 1]
  const prev = series.length >= 2 ? series[series.length - 2] : null
  const chartData = series.map((p) => ({
    year: p.year,
    住宅地: p.values['住宅地'] ?? null,
    商業地: p.values['商業地'] ?? null,
  }))

  return (
    <div className="mt-6 border-t border-slate-200 pt-5">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-3">
        <Landmark className="w-4 h-4 text-brand-700" />
        公示価格（確定・{latest.year}年）
      </h3>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <LandStat label="住宅地" value={latest.values['住宅地']} prevValue={prev?.values['住宅地']} />
        <LandStat label="商業地" value={latest.values['商業地']} prevValue={prev?.values['商業地']} />
      </div>

      {series.length >= 2 && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
          <ResponsiveContainer width="100%" height={130}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: -6, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#475569' }} tickLine={false} />
              <YAxis
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={44}
                tickFormatter={(v) => formatMan(Number(v))}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={{ color: '#e2e8f0' }}
                formatter={(v, name) => [`${Number(v).toLocaleString('ja-JP')}円/㎡`, name]}
                labelFormatter={(l) => `${l}年`}
              />
              <Line type="monotone" dataKey="住宅地" stroke="#60a5fa" strokeWidth={2} dot={{ r: 3, fill: '#60a5fa' }} connectNulls />
              <Line type="monotone" dataKey="商業地" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b' }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="text-slate-500 text-[11px] mt-2 leading-relaxed">
        国土交通省 地価公示・都道府県地価調査（確定・公表値）
      </p>
    </div>
  )
}

function LandStat({ label, value, prevValue }: { label: string; value?: number; prevValue?: number }) {
  const has = value != null
  const delta = has && prevValue != null && prevValue !== 0 ? ((value - prevValue) / prevValue) * 100 : null
  const positive = (delta ?? 0) >= 0

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-center">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="text-lg font-black text-slate-900 mt-0.5">
        {has ? value.toLocaleString('ja-JP') : '—'}
        <span className="text-[10px] font-bold text-slate-400 ml-0.5">円/㎡</span>
      </div>
      {delta != null && (
        <div className={`text-[11px] font-bold mt-0.5 ${positive ? 'text-blue-400' : 'text-red-400'}`}>
          {positive ? '+' : ''}
          {delta.toFixed(1)}%（前年比）
        </div>
      )}
    </div>
  )
}

function TradePriceBlock({
  series,
  latest,
}: {
  series: TradePoint[]
  latest: Partial<Record<TradeType, TradeLatestEntry>>
}) {
  const chartData = series.map((p) => ({
    key: `${p.year}Q${p.quarter}`,
    '中古マンション等': p.values['中古マンション等'] ?? null,
    '宅地(土地)': p.values['宅地(土地)'] ?? null,
    '宅地(土地と建物)': p.values['宅地(土地と建物)'] ?? null,
  }))
  const asOfLatest = series[series.length - 1]

  return (
    <div className="mt-6 border-t border-slate-200 pt-5">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <Coins className="w-4 h-4 text-[#854F0B]" />
          取引価格中央値（参考・{asOfLatest.year}年Q{asOfLatest.quarter}）
        </h3>
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#FAEEDA] text-[#854F0B]">
          参考
        </span>
      </div>
      <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">
        国土交通省 不動産取引価格情報を当社で四半期集計した中央値です。当社集計の参考値であり、公的な確定値ではありません。
      </p>

      <div className="space-y-2 mb-3">
        {TRADE_TYPES.map((t) => (
          <TradeStatRow key={t} label={t} entry={latest[t]} />
        ))}
      </div>

      {series.length >= 2 && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
          <ResponsiveContainer width="100%" height={130}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: -6, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis dataKey="key" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={{ stroke: '#475569' }} tickLine={false} />
              <YAxis
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={44}
                tickFormatter={(v) => formatMan(Number(v))}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={{ color: '#e2e8f0' }}
                formatter={(v, name) => [`${Number(v).toLocaleString('ja-JP')}円/㎡`, name]}
              />
              <Line type="monotone" dataKey="中古マンション等" stroke="#fbbf24" strokeWidth={2} dot={{ r: 2 }} connectNulls />
              <Line type="monotone" dataKey="宅地(土地)" stroke="#34d399" strokeWidth={2} dot={{ r: 2 }} connectNulls />
              <Line type="monotone" dataKey="宅地(土地と建物)" stroke="#a78bfa" strokeWidth={2} dot={{ r: 2 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

function TradeStatRow({ label, entry }: { label: string; entry?: TradeLatestEntry }) {
  return (
    <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 border-l-4 border-amber-400">
      <span className="text-xs text-slate-500">{label}</span>
      <div className="text-right">
        <div className="text-sm font-bold text-slate-900">
          {entry ? entry.value.toLocaleString('ja-JP') : '—'}
          <span className="text-[10px] font-bold text-slate-400 ml-0.5">円/㎡</span>
        </div>
        {entry && (
          <div className="text-[10px] text-slate-500 leading-none">
            {entry.year}年Q{entry.quarter}・n={entry.sampleCount ?? '—'}
          </div>
        )}
      </div>
    </div>
  )
}

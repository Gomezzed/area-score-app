'use client'

import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { MunicipalityWithStats } from '@/types'
import { formatPopulation, formatDelta, deltaColor, CENSUS } from '@/lib/census'
import { usePopulationHistory } from '@/hooks/usePopulationHistory'
import { TransactionSection } from './TransactionSection'
import { TownPrioritySection } from './TownPrioritySection'
import { StationDrilldownSection } from './StationDrilldownSection'
import { MarketMetricsSection } from './MarketMetricsSection'
import { X, Users, Home, TrendingUp, TrendingDown, BarChart2 } from 'lucide-react'

interface Props {
  municipality: MunicipalityWithStats | null
  onClose: () => void
}

export function MunicipalityDetailPanel({ municipality: m, onClose }: Props) {
  const open = m != null

  return (
    <div
      className={`absolute inset-y-0 right-0 w-full md:w-96 bg-white border-l border-slate-200 shadow-xl z-[1100] overflow-y-auto transition-transform duration-300 ease-out ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
      aria-hidden={!open}
    >
      {m && <PanelBody m={m} onClose={onClose} />}
    </div>
  )
}

function PanelBody({ m, onClose }: { m: MunicipalityWithStats; onClose: () => void }) {
  const positive = (m.deltaRate ?? 0) >= 0

  return (
      <div className="p-5">
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: deltaColor(m.deltaRate) }} />
            <h2 className="text-lg font-bold text-slate-900 leading-tight">{m.name}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="flex items-center justify-center min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 -mr-2 md:mr-0 text-slate-400 hover:text-slate-900 transition-colors md:p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 人口（最新=2025速報） */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4 text-center">
          <div className="text-3xl font-black text-slate-900">{formatPopulation(m.popLatest)}</div>
          <div className="text-slate-400 text-sm mt-1">人口（{CENSUS.latestLabel}・国勢調査）</div>
        </div>

        {/* 増減率 */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {positive ? (
                <TrendingUp className="w-5 h-5 text-delta-up" />
              ) : (
                <TrendingDown className="w-5 h-5 text-delta-down" />
              )}
              <span className="text-sm text-slate-500">人口増減率（{CENSUS.deltaRangeLabel}）</span>
            </div>
            <span className={`text-xl font-bold ${m.deltaRate == null ? 'text-slate-500' : positive ? 'text-delta-up' : 'text-delta-down'}`}>
              {m.deltaRate == null ? '—' : `${positive ? '+' : ''}${m.deltaRate.toFixed(2)}%`}
            </span>
          </div>
          <div className="flex items-center justify-between mt-2 text-sm">
            <span className="text-slate-500">人口増減数</span>
            <span className={m.delta == null ? 'text-slate-500' : positive ? 'text-delta-up' : 'text-delta-down'}>
              {formatDelta(m.delta)}
            </span>
          </div>
        </div>

        {/* 内訳 */}
        <div className="space-y-2">
          <Row icon={<Users className="w-4 h-4 text-brand-700" />} label="人口（2020年）" value={formatPopulation(m.popPrev)} />
          <Row icon={<Users className="w-4 h-4 text-brand-700" />} label="人口（2015年）" value={formatPopulation(m.popPrev2)} />
          <Row icon={<Home className="w-4 h-4 text-brand-700" />} label={`世帯数（${CENSUS.latestLabel}）`} value={m.householdsLatest == null ? '—' : `${m.householdsLatest.toLocaleString('ja-JP')}世帯`} />
        </div>

        {/* 人口推移（2015〜2025） — 不動産取引セクションの上に配置 */}
        <PopulationSection municipalityId={m.id} />

        {/* マンション取引履歴 */}
        <TransactionSection municipalityId={m.id} />

        {/* 駅乗降客数（XKT015 集約値） — 不動産取引セクションの下に配置 */}
        <StationSection total={m.stationPassengersTotal} />

        {/* 駅単位ドリルダウン（Standard+・自己ゲート / 機能フラグ尊重）。条件未達なら何も描画しない。 */}
        <StationDrilldownSection municipalityId={m.id} />

        {/* 相場・公示価格（Standard+・自己ゲート / 機能フラグ尊重・T8）。muni_code(5桁JIS)未確定
            または条件未達なら何も描画しない。確定(公示価格)/参考(取引価格中央値)は個別に出し分け。 */}
        <MarketMetricsSection muniCode={m.city_code} />

        {/* 町域別 仕入れ優先度（Platinum 専用・自己ゲート）。非platinum では何も描画しない。
            選択中市区町村の city_code(5桁JIS) を渡し、実データの有無で自動出し分け。 */}
        <TownPrioritySection cityCode={m.city_code} muniName={m.name} />

        <p className="text-xs text-slate-500 mt-5">
          出典: 総務省統計局 国勢調査（e-Stat）／
          国土交通省 不動産情報ライブラリ（不動産価格情報 XIT001・駅別乗降客数 XKT015）
        </p>
      </div>
  )
}

// 人口推移（2015〜2025）折れ線グラフ
// グラフのツールチップ（クローム）。系列色はデータ色のため別途据え置く。
const TOOLTIP_STYLE = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '0.5rem',
  boxShadow: '0 2px 8px rgb(15 23 42 / 0.12)',
  color: '#0f172a',
  fontSize: '12px',
}

// Y軸目盛り: 10000 以上は「万」単位に変換
const formatMan = (v: number): string =>
  v >= 10000
    ? `${(v / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}万`
    : v.toLocaleString('ja-JP')

function PopulationSection({ municipalityId }: { municipalityId: string }) {
  const { data, loading } = usePopulationHistory(municipalityId)
  const hasData = data.length > 0

  return (
    <div className="mt-5">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-3">
        <Users className="w-4 h-4 text-brand-700" />
        人口推移（2015〜2025）
      </h3>

      {loading && (
        <div className="text-slate-500 text-sm py-8 text-center">読み込み中…</div>
      )}

      {!loading && !hasData && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg py-8 text-center">
          <Users className="w-7 h-7 text-slate-300 mx-auto mb-2" />
          <p className="text-slate-500 text-sm">データ準備中（順次公開）</p>
        </div>
      )}

      {!loading && hasData && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={data} margin={{ top: 4, right: 8, left: -6, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={48}
                domain={['auto', 'auto']}
                tickFormatter={(v) => formatMan(Number(v))}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={{ color: '#64748b' }}
                formatter={(v) => [`${Number(v).toLocaleString('ja-JP')}人`, '人口']}
                labelFormatter={(l) => `${l}年`}
              />
              <Line
                type="monotone"
                dataKey="population"
                stroke="#60a5fa"
                strokeWidth={2}
                dot={{ r: 3, fill: '#60a5fa' }}
                activeDot={{ r: 5 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// 駅乗降客数: 市区町村単位の集約値（XKT015）。駅単位の明細は StationDrilldownSection で提供済み。
// 路線・運営会社別の内訳（stations は group_code 単位で1行のため未保持）が Phase 2.5。
function StationSection({ total }: { total: number }) {
  const hasData = total > 0

  return (
    <div className="mt-5">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-3">
        <BarChart2 className="w-4 h-4 text-brand-700" />
        駅乗降客数（最新）
      </h3>

      {hasData ? (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
          <div className="text-3xl font-black text-slate-900">
            {total.toLocaleString('ja-JP')}
            <span className="text-base font-bold text-slate-400 ml-1">人/日</span>
          </div>
          <div className="text-slate-400 text-xs mt-1">
            市区町村内の駅 乗降客数の合計（国交省 XKT015）
          </div>
          <p className="text-slate-500 text-[11px] mt-2 leading-relaxed">
            路線・運営会社別の内訳は今後のアップデートで公開予定です。
          </p>
        </div>
      ) : (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
          <p className="text-slate-500 text-xs leading-relaxed">
            国土交通省 駅別乗降客数（XKT015）データ準備中（順次公開）。
            鉄道駅のない市区町村では表示されません。
          </p>
        </div>
      )}
    </div>
  )
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm text-slate-500">{label}</span>
      </div>
      <span className="text-sm font-semibold text-slate-900">{value}</span>
    </div>
  )
}

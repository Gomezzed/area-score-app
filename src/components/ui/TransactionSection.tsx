'use client'

import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'
import Link from 'next/link'
import { Building2, Hash, JapaneseYen, Ruler, Square, Lock } from 'lucide-react'
import { useTransactions } from '@/hooks/useTransactions'
import { type PlanId } from '@/lib/plans'
import { TransactionYearSummary } from '@/types'

interface Props {
  municipalityId: string | null
  plan: PlanId
}

const fmt = (v: number | null | undefined, digits = 1): string =>
  v == null ? '—' : v.toLocaleString('ja-JP', { maximumFractionDigits: digits })

export function TransactionSection({ municipalityId, plan }: Props) {
  // 取引履歴の閲覧は Starter 以上。free は「プラン起因のロック」であって
  //   「データ不在」ではない。両者を別分岐で扱い、文言で区別する。
  //   free では従来どおり fetch を発火させない（municipalityId を null 化）ため
  //   空振りリクエストは出ない。starter+ は locked=false となり municipalityId=m.id
  //   をそのまま使う（＝従来の閲覧挙動を完全に維持）。
  const locked = plan === 'free'
  const { yearly, loading, error } = useTransactions(locked ? null : municipalityId)

  const hasData = yearly.some((y) => y.count > 0)
  const latest = hasData ? yearly[yearly.length - 1] : null

  return (
    <div className="mt-5">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-3">
        <Building2 className="w-4 h-4 text-brand-700" />
        マンション取引履歴
      </h3>

      {/* プラン起因のロック（free）: アップセル導線。データ不在とは明確に区別する。 */}
      {locked && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg py-8 px-4 text-center">
          <Lock className="w-7 h-7 text-brand-700 mx-auto mb-2" />
          <p className="text-slate-900 text-sm font-bold">
            マンション取引履歴は Starter プラン以上
          </p>
          <p className="text-slate-500 text-xs mt-1 mb-4 leading-relaxed">
            中古マンションの取引件数・平均価格・㎡単価の推移をご覧いただけます。
          </p>
          <Link
            href="/pricing"
            className="inline-flex items-center px-4 py-2 rounded-lg bg-brand-700 hover:bg-brand-500 text-white text-sm font-medium transition-colors"
          >
            プランを見る
          </Link>
        </div>
      )}

      {!locked && loading && (
        <div className="text-slate-500 text-sm py-8 text-center">読み込み中…</div>
      )}

      {/* データ不在（starter+ でも取引データが無い市区町村）: 従来どおり「データなし」。 */}
      {!locked && !loading && (error || !hasData) && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg py-8 text-center">
          <Building2 className="w-7 h-7 text-slate-400 mx-auto mb-2" />
          <p className="text-slate-500 text-sm">データなし</p>
          <p className="text-slate-500 text-xs mt-1">
            この市区町村の中古マンション取引データはありません
          </p>
        </div>
      )}

      {!locked && !loading && !error && hasData && (
        <div className="space-y-5">
          {/* 最新年サマリ */}
          {latest && (
            <div>
              <div className="text-xs text-slate-400 mb-2">{latest.year}年サマリ</div>
              <div className="grid grid-cols-2 gap-2">
                <SummaryCard
                  icon={<Hash className="w-3.5 h-3.5 text-brand-700" />}
                  label="取引件数"
                  value={`${fmt(latest.count, 0)}件`}
                />
                <SummaryCard
                  icon={<JapaneseYen className="w-3.5 h-3.5 text-emerald-600" />}
                  label="平均価格"
                  value={`${fmt(latest.avgPriceManYen, 0)}万円`}
                />
                <SummaryCard
                  icon={<Ruler className="w-3.5 h-3.5 text-amber-600" />}
                  label="平均㎡単価"
                  value={`${fmt(latest.avgPricePerSqm, 1)}万円/㎡`}
                />
                <SummaryCard
                  icon={<Square className="w-3.5 h-3.5 text-purple-600" />}
                  label="平均面積"
                  value={`${fmt(latest.avgAreaSqm, 1)}㎡`}
                />
              </div>
            </div>
          )}

          {/* 年別取引件数（棒グラフ） */}
          <ChartBlock title="年別取引件数">
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={yearly} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="year" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
                <Tooltip
                  cursor={{ fill: 'rgba(148,163,184,0.1)' }}
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: '#64748b' }}
                  formatter={(v) => [`${fmt(Number(v), 0)}件`, '取引件数']}
                  labelFormatter={(l) => `${l}年`}
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartBlock>

          {/* 年別平均㎡単価推移（折れ線グラフ） */}
          <ChartBlock title="年別平均㎡単価推移（万円/㎡）">
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={yearly} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="year" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} width={40} domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: '#64748b' }}
                  formatter={(v) => [`${fmt(Number(v), 1)}万円/㎡`, '平均㎡単価']}
                  labelFormatter={(l) => `${l}年`}
                />
                <Line
                  type="monotone"
                  dataKey="avgPricePerSqm"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#f59e0b' }}
                  activeDot={{ r: 5 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartBlock>
        </div>
      )}
    </div>
  )
}

// グラフのツールチップ（クローム）。系列色はデータ色のため別途据え置く。
const TOOLTIP_STYLE = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '0.5rem',
  boxShadow: '0 2px 8px rgb(15 23 42 / 0.12)',
  color: '#0f172a',
  fontSize: '12px',
}

function ChartBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
      <div className="text-xs text-slate-400 mb-2">{title}</div>
      {children}
    </div>
  )
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1">
        {icon}
        {label}
      </div>
      <div className="text-slate-900 font-bold text-sm">{value}</div>
    </div>
  )
}

export type { TransactionYearSummary }

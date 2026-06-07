/**
 * ============================================================================
 *  src/components/town/TownPopulationChart.tsx
 *  町丁目別 人口推移 折れ線グラフ (Recharts)
 * ============================================================================
 *  - 既存 AreaDetailPanel 内 Recharts 利用パターンに準拠したスタイル
 *  - 総人口 / ファミリー世代 (20-49歳) / 高齢者 の3系列を1グラフに重ねて表示
 *  - 単一年データしかない場合は数値カードのみ表示 (折れ線描画は省略)
 * ============================================================================
 */
'use client'

import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { useTownPopulationHistory } from '@/hooks/useTownInflow'
import { Users, TrendingUp } from 'lucide-react'

interface Props {
  townId:    string | null
  townName?: string
}

function fmtPop(n: number): string {
  if (Math.abs(n) >= 10_000) return (n / 10_000).toFixed(1) + '万'
  return n.toLocaleString()
}

export function TownPopulationChart({ townId, townName }: Props) {
  const { data, loading, error } = useTownPopulationHistory(townId)
  const points = data.points

  if (!townId) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500 text-xs px-4 text-center">
        ← ランキングから町丁目を選択すると、人口推移グラフが表示されます
      </div>
    )
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500 text-xs">
        読み込み中…
      </div>
    )
  }

  if (error || points.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500 text-xs">
        この町丁目の人口推移データはまだ投入されていません
      </div>
    )
  }

  const latest   = points[points.length - 1]
  const earliest = points[0]
  const popDelta = latest.total_population - earliest.total_population
  const popPct   = earliest.total_population > 0
    ? (popDelta / earliest.total_population * 100)
    : 0

  // Recharts 用に整形 (xAxis 表示は西暦4桁)
  const chartData = points.map((p) => ({
    year:           p.year,
    total:          p.total_population,
    family:         p.age_family_total,    // 20-49歳
    senior:         p.age_65_plus,
    households:     p.total_households,
  }))

  return (
    <div className="h-full flex flex-col">
      {/* ヘッダ・サマリー */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div>
          <div className="text-xs text-slate-400 leading-tight">人口推移</div>
          <div className="text-sm font-semibold text-white truncate">
            {townName ?? data.town?.full_name ?? ''}
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-1.5">
            <Users className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-lg font-bold text-white tabular-nums">
              {fmtPop(latest.total_population)}
            </span>
            <span className="text-[10px] text-slate-500">人</span>
          </div>
          <div className="flex items-center justify-end gap-1 mt-0.5">
            <TrendingUp className={`w-3 h-3 ${popDelta >= 0 ? 'text-emerald-400' : 'text-orange-400'}`} />
            <span className={`text-[11px] font-medium tabular-nums ${popDelta >= 0 ? 'text-emerald-400' : 'text-orange-400'}`}>
              {earliest.year}→{latest.year}
              {' '}
              {popDelta >= 0 ? '+' : ''}{fmtPop(popDelta)} ({popPct >= 0 ? '+' : ''}{popPct.toFixed(1)}%)
            </span>
          </div>
        </div>
      </div>

      {/* グラフ本体 */}
      <div className="flex-1 px-2 pb-2 min-h-0">
        {chartData.length === 1 ? (
          <div className="h-full grid grid-cols-3 gap-2 px-2">
            <StatCard label="総人口"           value={fmtPop(latest.total_population)} unit="人" />
            <StatCard label="ファミリー(20-49)" value={fmtPop(latest.age_family_total)} unit="人" />
            <StatCard label="高齢者(65+)"       value={fmtPop(latest.age_65_plus)}      unit="人" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 10, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis
                dataKey="year"
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                tickLine={false}
                axisLine={{ stroke: '#475569' }}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => fmtPop(v)}
                width={42}
              />
              <Tooltip
                contentStyle={{
                  background:    '#1e293b',
                  border:        '1px solid #475569',
                  fontSize:      11,
                  borderRadius:  8,
                  padding:       '8px 10px',
                }}
                labelStyle={{ color: '#cbd5e1', fontWeight: 600, marginBottom: 4 }}
                formatter={(value: unknown, name: unknown) => {
                  const label = ({
                    total:  '総人口',
                    family: 'ファミリー世代 (20-49)',
                    senior: '高齢者 (65+)',
                  } as Record<string, string>)[String(name)] ?? String(name)
                  return [`${fmtPop(Number(value))}人`, label]
                }}
                labelFormatter={(year) => `${year}年`}
                cursor={{ stroke: 'rgba(255,255,255,0.12)', strokeWidth: 1 }}
              />
              <Legend
                wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
                iconType="circle"
                iconSize={8}
                formatter={(v) => {
                  const map: Record<string, string> = {
                    total:  '総人口',
                    family: 'ファミリー(20-49)',
                    senior: '高齢者(65+)',
                  }
                  return <span style={{ color: '#cbd5e1' }}>{map[v] ?? v}</span>
                }}
              />
              <Line
                type="monotone" dataKey="total"  stroke="#60a5fa" strokeWidth={2.5}
                dot={{ r: 3.5, fill: '#60a5fa' }} activeDot={{ r: 5.5 }}
                name="total"
              />
              <Line
                type="monotone" dataKey="family" stroke="#f472b6" strokeWidth={2}
                dot={{ r: 3, fill: '#f472b6' }} activeDot={{ r: 5 }}
                name="family" strokeDasharray="4 2"
              />
              <Line
                type="monotone" dataKey="senior" stroke="#fbbf24" strokeWidth={2}
                dot={{ r: 3, fill: '#fbbf24' }} activeDot={{ r: 5 }}
                name="senior" strokeDasharray="2 3"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* フッタ: 1世帯あたり人数 */}
      <div className="px-4 pb-2 text-[10px] text-slate-500 flex justify-between border-t border-slate-700/50 pt-1.5">
        <span>1世帯あたり人数 ({latest.year}年): <span className="text-slate-300 font-medium tabular-nums">{latest.avg_household_size.toFixed(2)}人</span></span>
        <span className="text-slate-600">出典: e-Stat 国勢調査</span>
      </div>
    </div>
  )
}

function StatCard({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="bg-slate-700/40 rounded-lg p-3 flex flex-col justify-center">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="text-lg font-bold text-white mt-1 tabular-nums">
        {value}<span className="text-[10px] font-normal text-slate-500 ml-0.5">{unit}</span>
      </div>
    </div>
  )
}

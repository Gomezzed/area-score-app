'use client'

import { useEffect, useState } from 'react'
import { Train } from 'lucide-react'
import { useSubscription } from '@/hooks/useSubscription'
import { canUse } from '@/lib/plans'

interface StationItem {
  stationId: string
  name: string
  operator: string | null
  lineName: string | null
  lat: number | null
  lng: number | null
  confirmed: {
    passengersLatest: number | null
    passengersYear: number | null
  }
}

interface StationsResponse {
  municipalityId: string
  items: StationItem[]
}

const fmtInt = (v: number | null): string => (v == null ? '—' : v.toLocaleString('ja-JP'))

// 駅単位ドリルダウン（Standard 以上）。
//   表示可否 = canUse(plan,'stationLevelEntitled')（権限）AND マスターフラグ
//   NEXT_PUBLIC_FEATURE_STATION_LEVEL（既存 usePlanLimit と同じ AND 設計を踏襲。plan 直書き禁止）。
//   条件未達（free/starter またはフラグ off）はセクションごと非表示。
export function StationDrilldownSection({ municipalityId }: { municipalityId: string }) {
  const { plan } = useSubscription()
  const entitled = canUse(plan, 'stationLevelEntitled')
  const featureOn = process.env.NEXT_PUBLIC_FEATURE_STATION_LEVEL === 'true'
  const allowed = entitled && featureOn

  const [items, setItems] = useState<StationItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!allowed || !municipalityId) return
    let mounted = true
    // setState は await 後のコールバック内でのみ行う（effect 本体での同期 setState を避ける）。
    async function load() {
      try {
        const res = await fetch(`/api/stations?municipality_id=${encodeURIComponent(municipalityId)}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as StationsResponse
        if (mounted) {
          setItems(json.items)
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
  }, [allowed, municipalityId])

  // 権限なし / フラグ off は非表示。
  if (!allowed) return null

  const list = items ?? []

  return (
    <div className="mt-6 border-t border-slate-700 pt-5">
      <h3 className="flex flex-wrap items-center gap-2 text-sm font-bold text-white mb-1">
        <Train className="w-4 h-4 text-blue-400" />
        駅単位ドリルダウン
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 ring-1 ring-blue-400/40">
          Standard+
        </span>
      </h3>
      <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">
        市区町村内の駅ごとの乗降客数（確定・国交省 XKT015）。乗降客数の多い順。
      </p>

      {loading && <div className="text-slate-500 text-sm py-6 text-center">読み込み中…</div>}

      {!loading && error && (
        <div className="bg-slate-700/30 rounded-lg py-6 text-center text-slate-500 text-sm">{error}</div>
      )}

      {!loading && !error && list.length === 0 && (
        <div className="bg-slate-700/30 rounded-lg py-6 text-center text-slate-500 text-sm">
          この市区町村に登録された駅はありません
        </div>
      )}

      {!loading && !error && list.length > 0 && (
        <>
          <div className="space-y-2">
            {list.map((s) => (
              <StationRow key={s.stationId} s={s} />
            ))}
          </div>
          <p className="text-[11px] text-slate-500 mt-3">
            出典: 国土交通省 不動産情報ライブラリ 駅別乗降客数（XKT015）・確定値
          </p>
        </>
      )}
    </div>
  )
}

// 駅1件。全て確定（公表値）のため青帯で表示し「推定」バッジは付けない。
function StationRow({ s }: { s: StationItem }) {
  const label = [s.operator, s.lineName].filter(Boolean).join(' ・ ') || '—'
  return (
    <div className="rounded-lg border border-slate-700 border-l-4 border-l-blue-400 bg-slate-800/60 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-bold text-white truncate">
            {s.name}
            <span className="text-slate-400 font-normal text-xs">駅</span>
          </div>
          <div className="text-[10px] text-slate-400 truncate">{label}</div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-base font-black text-white leading-tight">
            {fmtInt(s.confirmed.passengersLatest)}
            <span className="text-[10px] font-bold text-slate-400 ml-0.5">人/日</span>
          </div>
          <div className="text-[10px] text-slate-500 leading-none">
            {s.confirmed.passengersYear ? `${s.confirmed.passengersYear}年` : ''} 確定
          </div>
        </div>
      </div>
    </div>
  )
}

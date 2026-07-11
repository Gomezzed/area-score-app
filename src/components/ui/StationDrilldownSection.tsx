'use client'

import { useEffect, useState } from 'react'
import { Train } from 'lucide-react'
import { useSubscription } from '@/hooks/useSubscription'
import { usePlanLimit } from '@/hooks/usePlanLimit'

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

// 折りたたみ時に表示する上位件数（全件は「すべて表示」トグルで展開）。
const MAX_VISIBLE = 5

// 駅単位ドリルダウン（Standard 以上）。
//   表示可否 = usePlanLimit(plan).stationLevelEnabled
//   （= 権限 stationLevelEntitled AND マスターフラグ NEXT_PUBLIC_FEATURE_STATION_LEVEL。
//    フラグ評価は usePlanLimit に一本化し、本コンポーネントでは再評価しない。plan 直書き禁止）。
//   条件未達（free/starter またはフラグ off）はセクションごと非表示。
export function StationDrilldownSection({ municipalityId }: { municipalityId: string }) {
  const { plan } = useSubscription()
  // 実利用可否の単一ソース（権限 AND フラグの評価は usePlanLimit 側）
  const { stationLevelEnabled: allowed } = usePlanLimit(plan)

  const [items, setItems] = useState<StationItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // プルダウン選択・全件展開は「どの市区町村での操作か」を併せて保持し、
  // 市区町村切替時に derive で自動リセットする（effect での同期 setState を避ける既存流儀）。
  const [selection, setSelection] = useState<{ muni: string; stationId: string } | null>(null)
  const [expandedFor, setExpandedFor] = useState<string | null>(null)

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
  // 現在の市区町村での選択のみ有効（切替直後の古い選択を排除）。
  const selectedId = selection && selection.muni === municipalityId ? selection.stationId : ''
  const selected = selectedId ? list.find((s) => s.stationId === selectedId) ?? null : null
  const expanded = expandedFor === municipalityId
  const visibleList = expanded ? list : list.slice(0, MAX_VISIBLE)

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
          {/* 駅プルダウン（乗降客数降順・API のソート順をそのまま使用） */}
          <select
            value={selectedId}
            onChange={(e) =>
              setSelection(
                e.target.value ? { muni: municipalityId, stationId: e.target.value } : null,
              )
            }
            aria-label="駅を選択"
            className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white text-sm px-3 py-2 mb-3 focus:outline-none focus:border-blue-500"
          >
            <option value="">駅を選択（{list.length}駅）</option>
            {list.map((s) => (
              <option key={s.stationId} value={s.stationId} className="bg-slate-800">
                {s.name}（{fmtInt(s.confirmed.passengersLatest)}人/日）
              </option>
            ))}
          </select>

          {/* 選択駅カード（未選択時は非表示） */}
          {selected && <SelectedStationCard s={selected} />}

          {/* 降順リスト（上位5件＋全件トグル） */}
          <div className="space-y-2">
            {visibleList.map((s) => (
              <StationRow key={s.stationId} s={s} />
            ))}
          </div>
          {list.length > MAX_VISIBLE && (
            <button
              type="button"
              onClick={() => setExpandedFor(expanded ? null : municipalityId)}
              className="w-full mt-2 py-1.5 rounded-lg bg-slate-700/30 border border-slate-700 text-[11px] font-bold text-blue-300 hover:text-blue-200 hover:bg-slate-700/50 transition-colors"
            >
              {expanded ? `上位${MAX_VISIBLE}件に戻す` : `すべて表示（${list.length}駅）`}
            </button>
          )}
          <p className="text-[11px] text-slate-500 mt-3">
            出典: 国土交通省 不動産情報ライブラリ 駅別乗降客数（XKT015）・確定値
          </p>
        </>
      )}
    </div>
  )
}

// プルダウンで選択された駅の詳細カード。集約値カード（StationSection）と同じ大きめ表示の流儀。
// 全て確定（公表値）のため「推定」バッジは付けない。
function SelectedStationCard({ s }: { s: StationItem }) {
  const label = [s.operator, s.lineName].filter(Boolean).join(' ・ ')
  return (
    <div className="bg-slate-700/50 rounded-xl p-4 mb-3 text-center border border-slate-600">
      <div className="text-sm font-bold text-white">
        {s.name}
        <span className="text-slate-400 font-normal text-xs">駅</span>
      </div>
      {label && <div className="text-[11px] text-slate-400 mt-0.5">{label}</div>}
      <div className="text-3xl font-black text-white mt-2">
        {fmtInt(s.confirmed.passengersLatest)}
        <span className="text-base font-bold text-slate-400 ml-1">人/日</span>
      </div>
      <div className="text-slate-400 text-xs mt-1">
        確定（公表値）{s.confirmed.passengersYear ? `・${s.confirmed.passengersYear}年基準` : ''}
      </div>
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

'use client'

// =====================================================================
// 顧客名簿の校区ヒートマップ地図（M2-6c PR-β）。
//   状態は URL クエリで持つ:
//     /customers/map?list=<顧客名簿UUID>&muni=<5桁>&type=<elementary|junior_high>
//   - 二層封鎖は /customers と同一（NEXT_PUBLIC_FEATURE_CUSTOMER_LIST ＋
//     canUse(plan,'townAcquisitionPriority')）。新しい判定ロジックは書き起こさない。
//   - 地図は素の Leaflet（react-leaflet は使わない）。SSR 回避は既存の
//     学区図オーバーレイ（MunicipalityMap）と同じく useEffect 内で import('leaflet')。
//   - ポリゴンと濃淡の突合キーは properties.id ↔ RankingRow.school_district_id（校区名では突合しない）。
// =====================================================================

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { notFound, useSearchParams } from 'next/navigation'
import { ArrowLeft, Lock, Loader2, X } from 'lucide-react'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type {
  GeoJSON as LeafletGeoJSON,
  Layer,
  Map as LeafletMap,
  PathOptions,
} from 'leaflet'
import { useSubscription } from '@/hooks/useSubscription'
import { canUse } from '@/lib/plans'
import {
  SCHOOL_TYPES,
  SCHOOL_TYPE_LABELS,
  DEFAULT_SCHOOL_TYPE,
  SCHOOL_DISTRICT_DISCLAIMER,
  isSchoolType,
  type SchoolType,
} from '@/lib/school-districts'
import { TIER_LABEL } from '@/lib/school-district-tiers'
import { TIER_FILL, NO_DATA_FILL, tierToPathStyle } from '@/lib/school-district-map-style'

// UI/API の二層封鎖の上層（/customers/page.tsx と同一の環境フラグ）。
const FEATURE_ON = process.env.NEXT_PUBLIC_FEATURE_CUSTOMER_LIST === 'true'

// グレー凡例の逐語文言（閾値そのものは書かない）。
const NO_DATA_LEGEND = '件数が少ないため表示していません'

// ── 取込エリア一覧（GET /api/customer-lists/[id]/areas）の1行 ──
interface AreaRow {
  muni_code_5: string
  muni_name: string
  prefecture_name: string | null
  has_school_districts: boolean
}
interface AreasResponse {
  id: string
  name: string
  school_type: string
  areas: AreaRow[]
}

// ── 校区ランキング（GET /api/customer-lists/[id]/school-district-ranking）の1行 ──
interface RankingRow {
  school_district_id: string
  school_name: string
  muni_code_5: string
  muni_name: string
  tier: number
  attribution_text: string | null
}
interface RankingResponse {
  id: string
  name: string
  school_type: string
  rows: RankingRow[]
}

// ── ポリゴン GeoJSON の Feature.properties（/api/school-districts）──
interface DistrictProps {
  id: string
  school_name: string
  school_type: string
  muni_code_5: string
  attribution_text: string | null
  label_lng: number
  label_lat: number
}

function FullPageLoading() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-400">
      <Loader2 className="w-4 h-4 animate-spin mr-2" />
      読み込み中…
    </div>
  )
}

function BackLink() {
  return (
    <Link
      href="/customers"
      className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
    >
      <ArrowLeft className="w-4 h-4" />
      顧客名簿へ戻る
    </Link>
  )
}

// プラン未達（Standard 以下）のアップセル。判定は canUse(plan,'townAcquisitionPriority') のまま。
function UpsellBlock() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 mb-3">
        <Lock className="w-4 h-4 text-brand-700" />
        この機能は Platinum プランでご利用いただけます
      </div>
      <Link
        href="/pricing"
        className="inline-block text-sm font-semibold text-brand-700 hover:text-brand-500 transition-colors"
      >
        プランを見る
      </Link>
    </div>
  )
}

export default function CustomerMapPage() {
  // 上層封鎖：フラグ off ならページの存在ごと 404（/customers と同一）。
  if (!FEATURE_ON) notFound()
  return (
    <Suspense fallback={<FullPageLoading />}>
      <MapRouteInner />
    </Suspense>
  )
}

function MapRouteInner() {
  const sp = useSearchParams()
  const list = sp.get('list')
  const muni = sp.get('muni')
  const typeParam = sp.get('type')
  // 許可判定は @/lib/school-districts の isSchoolType を使う（3つ目の allowlist を作らない）。
  const type: SchoolType = isSchoolType(typeParam) ? typeParam : DEFAULT_SCHOOL_TYPE

  // 下層封鎖：プラン判定（/customers と同一のキー）。
  const { plan, isLoading: planLoading } = useSubscription()
  const allowed = canUse(plan, 'townAcquisitionPriority')

  if (planLoading) return <FullPageLoading />
  if (!allowed) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <BackLink />
        </div>
        <UpsellBlock />
      </div>
    )
  }

  if (!list) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
          <BackLink />
          <p className="text-sm text-slate-500">顧客名簿が指定されていません。</p>
        </div>
      </div>
    )
  }

  // key で再マウントし、muni/type 切替時に state を初期化する（effect 内の同期 setState を避ける）。
  return muni ? (
    <MapView key={`${muni}:${type}`} list={list} muni={muni} type={type} />
  ) : (
    <AreaListView key={type} list={list} type={type} />
  )
}

// ── muni 未指定：取込エリア一覧 ──
function AreaListView({ list, type }: { list: string; type: SchoolType }) {
  const [res, setRes] = useState<AreasResponse | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    // 再マウント（key=type）で初期化されるため、effect 冒頭での同期 setState は行わない。
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(
          `/api/customer-lists/${list}/areas?school_type=${encodeURIComponent(type)}`,
        )
        if (!alive) return
        if (!r.ok) {
          setFailed(true)
          return
        }
        setRes((await r.json()) as AreasResponse)
      } catch {
        if (alive) setFailed(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [list, type])

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <BackLink />
        <div>
          <h1 className="text-lg font-bold text-slate-900">校区ヒートマップ</h1>
          <p className="mt-1 text-sm text-slate-500">
            市区町村を選ぶと、その市内の校区ごとの反響の濃さを地図で表示します。
          </p>
        </div>

        {failed ? (
          <p className="text-sm text-slate-500">エリア一覧の取得に失敗しました。</p>
        ) : res === null ? (
          <FullPageLoading />
        ) : res.areas.length === 0 ? (
          <p className="text-sm text-slate-500">取込対象の市区町村がありません。</p>
        ) : (
          <ul className="divide-y divide-slate-100 bg-white border border-slate-200 rounded-xl overflow-hidden">
            {res.areas.map((a) => {
              const label = [a.prefecture_name, a.muni_name].filter(Boolean).join(' ')
              if (!a.has_school_districts) {
                return (
                  <li
                    key={a.muni_code_5}
                    className="flex items-center justify-between px-4 py-3 text-sm"
                  >
                    <span className="text-slate-500">{label}</span>
                    <span className="text-xs text-slate-400">校区レイヤー対象外</span>
                  </li>
                )
              }
              return (
                <li key={a.muni_code_5}>
                  <Link
                    href={`/customers/map?list=${encodeURIComponent(list)}&muni=${encodeURIComponent(
                      a.muni_code_5,
                    )}&type=${encodeURIComponent(type)}`}
                    className="flex items-center justify-between px-4 py-3 text-sm hover:bg-slate-50 transition-colors"
                  >
                    <span className="font-medium text-slate-900">{label}</span>
                    <span className="text-xs font-semibold text-brand-700">地図を開く →</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

// 小中切替タブ。elementary / junior_high の2択のみ。切替は URL の type を変える。
function SchoolTypeTabs({
  list,
  muni,
  current,
}: {
  list: string
  muni: string
  current: SchoolType
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="radiogroup" aria-label="校種切替">
      {SCHOOL_TYPES.map((t) => {
        const active = t === current
        return (
          <Link
            key={t}
            role="radio"
            aria-checked={active}
            href={`/customers/map?list=${encodeURIComponent(list)}&muni=${encodeURIComponent(
              muni,
            )}&type=${encodeURIComponent(t)}`}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              active ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {SCHOOL_TYPE_LABELS[t]}
          </Link>
        )
      })}
    </div>
  )
}

// 凡例（TIER_LABEL の4段＋グレー1段）。グレーは破線の色見本で「データ無し」を再現する。
function Legend() {
  return (
    <div className="absolute bottom-3 right-3 z-[1000] rounded-lg border border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur-sm">
      <div className="text-xs font-semibold text-slate-500 mb-1.5">校区別の反響の濃さ</div>
      {[4, 3, 2, 1].map((t) => (
        <div key={t} className="flex items-center gap-2 mb-1">
          <span
            className="inline-block w-4 h-3 rounded-sm border border-slate-500"
            style={{ backgroundColor: TIER_FILL[t], opacity: 0.85 }}
          />
          <span className="text-xs text-slate-700">{TIER_LABEL[t]}</span>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <span
          className="inline-block w-4 h-3 rounded-sm border border-dashed border-slate-400"
          style={{ backgroundColor: NO_DATA_FILL, opacity: 0.5 }}
        />
        <span className="text-xs text-slate-500">{NO_DATA_LEGEND}</span>
      </div>
    </div>
  )
}

interface Selected {
  props: DistrictProps
  tier: number | null
}

// 校区詳細パネル。校区名／自治体名／濃淡ラベル／出典＋免責のみ。
function DetailPanel({
  selected,
  muniName,
  onClose,
}: {
  selected: Selected
  muniName: string | null
  onClose: () => void
}) {
  const { props, tier } = selected
  const tierLabel = tier != null ? TIER_LABEL[tier] ?? NO_DATA_LEGEND : NO_DATA_LEGEND
  return (
    <div className="absolute top-3 right-3 z-[1000] w-72 max-w-[calc(100%-1.5rem)] rounded-lg border border-slate-200 bg-white/97 p-4 shadow-lg backdrop-blur-sm">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">{props.school_name}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          className="text-slate-400 hover:text-slate-700"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <dl className="mt-2 space-y-1.5 text-xs">
        <div className="flex gap-2">
          <dt className="text-slate-400 shrink-0">自治体</dt>
          <dd className="text-slate-700">{muniName ?? '—'}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-slate-400 shrink-0">濃さ</dt>
          <dd className="text-slate-700">{tierLabel}</dd>
        </div>
        {props.attribution_text && (
          <div className="flex gap-2">
            <dt className="text-slate-400 shrink-0">—</dt>
            <dd className="text-slate-500">{props.attribution_text}</dd>
          </div>
        )}
      </dl>
      <p className="mt-3 pt-2 border-t border-slate-100 text-[11px] leading-snug text-slate-400">
        {SCHOOL_DISTRICT_DISCLAIMER}
      </p>
    </div>
  )
}

// ── muni 指定：地図 ──
function MapView({ list, muni, type }: { list: string; muni: string; type: SchoolType }) {
  // FeatureCollection（ポリゴン）。properties は DistrictProps。
  const [geojson, setGeojson] = useState<FeatureCollection<Geometry, DistrictProps> | null>(null)
  // ランキング rows（null=読込中）。
  const [rankRows, setRankRows] = useState<RankingRow[] | null>(null)
  // 取込エリア（muni_name 解決用）。
  const [areas, setAreas] = useState<AreaRow[] | null>(null)
  const [selected, setSelected] = useState<Selected | null>(null)
  const [polyFailed, setPolyFailed] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const layerRef = useRef<LeafletGeoJSON | null>(null)

  // ポリゴン取得（再マウント key=muni:type により初期化されるため、冒頭での同期 setState はしない）。
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(
          `/api/school-districts?muni_code_5=${encodeURIComponent(muni)}&school_type=${encodeURIComponent(
            type,
          )}`,
        )
        if (!alive) return
        if (!r.ok) {
          setPolyFailed(true)
          return
        }
        const json = (await r.json()) as FeatureCollection<Geometry, DistrictProps>
        setGeojson(
          json && Array.isArray(json.features)
            ? json
            : { type: 'FeatureCollection', features: [] },
        )
      } catch {
        if (alive) setPolyFailed(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [muni, type])

  // ランキング取得（tier の突合元）。
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(
          `/api/customer-lists/${list}/school-district-ranking?school_type=${encodeURIComponent(type)}`,
        )
        if (!alive) return
        if (!r.ok) {
          setRankRows([])
          return
        }
        const json = (await r.json()) as RankingResponse
        setRankRows(json.rows ?? [])
      } catch {
        if (alive) setRankRows([])
      }
    })()
    return () => {
      alive = false
    }
  }, [list, type])

  // エリア（muni_name 解決）。
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(
          `/api/customer-lists/${list}/areas?school_type=${encodeURIComponent(type)}`,
        )
        if (!alive) return
        if (!r.ok) return
        const json = (await r.json()) as AreasResponse
        setAreas(json.areas ?? [])
      } catch {
        /* muni_name 解決は補助。失敗しても地図は描く */
      }
    })()
    return () => {
      alive = false
    }
  }, [list, type])

  // properties.id → tier の突合表（校区名では突合しない）。
  const tierById = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rankRows ?? []) m.set(r.school_district_id, r.tier)
    return m
  }, [rankRows])

  const muniName = useMemo(() => {
    const a = (areas ?? []).find((x) => x.muni_code_5 === muni)
    return a?.muni_name ?? null
  }, [areas, muni])

  // 出典（ポリゴンの attribution_text を重複除去。前置きしない）。
  const attributions = useMemo(() => {
    const set = new Set<string>()
    for (const f of geojson?.features ?? []) {
      const t = f.properties?.attribution_text
      if (t) set.add(t)
    }
    return Array.from(set)
  }, [geojson])

  // 地図初期化（マウント時1回。SSR 回避＝useEffect 内で import('leaflet'))。
  useEffect(() => {
    if (!containerRef.current || typeof window === 'undefined') return
    let cancelled = false
    import('leaflet').then((L) => {
      if (cancelled || mapRef.current) return
      delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl
      mapRef.current = L.map(containerRef.current!, {
        center: [36.2, 138.2],
        zoom: 9,
        preferCanvas: true,
      })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
        keepBuffer: 4,
      }).addTo(mapRef.current)
    })
    const el = containerRef.current
    const ro = new ResizeObserver(() => {
      if (mapRef.current) mapRef.current.invalidateSize()
    })
    ro.observe(el)
    return () => {
      cancelled = true
      ro.disconnect()
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [])

  // ポリゴン描画（geojson / tier 突合表が変わったら貼り直し、範囲へ fitBounds）。
  useEffect(() => {
    if (typeof window === 'undefined' || !geojson) return
    let cancelled = false
    import('leaflet').then((L) => {
      if (cancelled) return
      const map = mapRef.current
      if (!map) return
      if (layerRef.current) {
        layerRef.current.remove()
        layerRef.current = null
      }
      if (geojson.features.length === 0) return
      const layer = L.geoJSON<DistrictProps>(geojson, {
        style: (feature?: Feature<Geometry, DistrictProps>): PathOptions => {
          const id = feature?.properties?.id
          const tier = id != null ? tierById.get(id) ?? null : null
          return tierToPathStyle(tier)
        },
        onEachFeature: (feature: Feature<Geometry, DistrictProps>, lyr: Layer) => {
          lyr.on('click', () => {
            const props = feature.properties
            const tier = props?.id != null ? tierById.get(props.id) ?? null : null
            setSelected({ props, tier })
          })
        },
      })
      layer.addTo(map)
      layerRef.current = layer
      try {
        const b = layer.getBounds()
        if (b.isValid()) map.fitBounds(b, { padding: [30, 30], animate: false })
      } catch {
        /* 範囲計算に失敗しても地図は残す */
      }
    })
    return () => {
      cancelled = true
    }
  }, [geojson, tierById])

  // ランキング0件（該当反響なし）の判定。
  const noResponses = rankRows !== null && rankRows.length === 0

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="max-w-6xl w-full mx-auto px-4 py-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-4">
          <Link
            href={`/customers/map?list=${encodeURIComponent(list)}&type=${encodeURIComponent(type)}`}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            市区町村一覧へ
          </Link>
          <h1 className="text-base font-bold text-slate-900">{muniName ?? ''}</h1>
        </div>
        <SchoolTypeTabs list={list} muni={muni} current={type} />
      </div>

      <div className="relative flex-1 min-h-[70vh]">
        <div ref={containerRef} className="absolute inset-0" />

        {/* ポリゴン取得失敗 */}
        {polyFailed && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] rounded-md bg-white/95 px-3 py-1.5 text-xs text-slate-500 shadow-sm">
            校区ポリゴンの取得に失敗しました。
          </div>
        )}

        {/* ランキング0件：該当反響なし */}
        {noResponses && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] rounded-md bg-white/95 px-3 py-1.5 text-xs text-slate-600 shadow-sm">
            直近12ヶ月に該当する反響がありません
          </div>
        )}

        <Legend />

        {selected && (
          <DetailPanel selected={selected} muniName={muniName} onClose={() => setSelected(null)} />
        )}
      </div>

      {/* 出典（重複除去・前置きしない）＋免責。地図下に常時表示。 */}
      <div className="max-w-6xl w-full mx-auto px-4 py-2 text-[11px] leading-snug text-slate-400">
        {attributions.length > 0 && <p>{attributions.join(' / ')}</p>}
        <p>{SCHOOL_DISTRICT_DISCLAIMER}</p>
      </div>
    </div>
  )
}

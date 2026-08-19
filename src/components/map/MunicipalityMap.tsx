'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Lock } from 'lucide-react'
import type { LayerGroup } from 'leaflet'
import type { GeoJsonObject } from 'geojson'
import { Prefecture, MunicipalityWithStats } from '@/types'
import { deltaColor, DELTA_BUCKETS, formatPopulation, CENSUS } from '@/lib/census'
import { SchoolDistrictControl } from './SchoolDistrictControl'
import {
  SCHOOL_TYPES,
  DEFAULT_SCHOOL_TYPE,
  SCHOOL_DISTRICT_DISCLAIMER,
  availabilityKey,
  fetchAvailability,
  fetchDistricts,
  type SchoolDistrictFeatureCollection,
  type SchoolType,
} from '@/lib/school-districts'

// 学区ポリゴン境界線の色（塗りなし・境界線のみ）。濃淡/凡例は STEP4 管轄で持たない。
const SCHOOL_DISTRICT_STROKE = '#1d4ed8'

// divIcon の school_name ラベルに入れる前に最小限のエスケープ（XSS 防御）。
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

interface Props {
  prefecture: Prefecture
  municipalities: MunicipalityWithStats[]
  selectedId: string | null
  onSelect: (m: MunicipalityWithStats) => void
  // 料金v2.1: ヒートマップ（増減率カラー＋凡例）は Standard 以上のみ。
  // false のときピンを中立色にし凡例を伏せる（ベースマップ・ピン配置・ポップアップは不変）。
  canUseHeatmap: boolean
}

// ヒートマップ非対象プラン（Free/Starter）でのピン塗り色。増減率の色情報を伏せる中立グレー。
const NEUTRAL_MARKER_COLOR = '#9ca3af'

// lat/lng が未登録の市区町村を都道府県中心の周りに決定論的に配置する（フォールバック）
function stableOffset(seed: string, index: number): { lat: number; lng: number } {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0
  }
  const ring = Math.floor(index / 16)
  const angle = (index / 16) * 2 * Math.PI + (h & 0xff) * 0.012
  const radius = 0.06 + ring * 0.05
  return { lat: radius * Math.cos(angle), lng: radius * Math.sin(angle) }
}

export function MunicipalityMap({ prefecture, municipalities, selectedId, onSelect, canUseHeatmap }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markersRef = useRef<Map<string, any>>(new Map())
  // onSelect の最新参照（マーカー再生成なしでクリックハンドラを最新化）
  const onSelectRef = useRef(onSelect)
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  // ── 学区図オーバーレイ（M2-0 / SD-27・SD-36。境界線の表示のみ）──
  const schoolLayerRef = useRef<LayerGroup | null>(null)
  const [overlayOn, setOverlayOn] = useState(false)
  const [schoolType, setSchoolType] = useState<SchoolType>(DEFAULT_SCHOOL_TYPE)
  const [availability, setAvailability] = useState<Set<string> | null>(null)
  // 取得済みポリゴンを取得元キー付きで保持（key ズレ時に古い校種を描かないため）。
  const [districts, setDistricts] = useState<{ key: string; fc: SchoolDistrictFeatureCollection } | null>(null)

  // 選択中の市区町村コード（5桁＝muni_code_5）。dashboard を触らず内部導出する（D4）。
  const muniCode5 = useMemo(() => {
    const m = municipalities.find((x) => x.id === selectedId)
    return m?.city_code ?? null
  }, [municipalities, selectedId])

  // 選択市で公開されている校種（無ければトグル disabled）。8市ハードコードなし・muni×type 粒度（Q-C）。
  const availableTypes = useMemo<SchoolType[]>(() => {
    if (!muniCode5 || !availability) return []
    return SCHOOL_TYPES.filter((t) => availability.has(availabilityKey(muniCode5, t)))
  }, [muniCode5, availability])

  // 実効校種：選択校種が公開外なら公開されている校種へ寄せる（既定＝小学校区）。
  // クランプを派生値にすることで effect 内 setState（cascading render）を避ける。
  const effectiveSchoolType: SchoolType = availableTypes.includes(schoolType)
    ? schoolType
    : availableTypes[0] ?? schoolType

  // 取得対象キー（ON かつ市選択かつ公開校種のときのみ非 null）。未公開はここで null ＝フェッチしない。
  const targetKey =
    overlayOn && muniCode5 && availableTypes.includes(effectiveSchoolType)
      ? availabilityKey(muniCode5, effectiveSchoolType)
      : null

  // 取得中フラグは派生（対象キーの結果がまだ揃っていない間）。state を持たず setState を減らす。
  const loadingDistricts = targetKey !== null && districts?.key !== targetKey

  // 未公開文言：市選択済みだが公開校区が1つも無いとき（Q-C の muni 全体未公開）。
  const showUnavailable = !!muniCode5 && availability !== null && availableTypes.length === 0

  // 公開ペア一覧をセッション1回だけ取得（disabled 前置判定用）。未公開市では以後リクエスト0件。
  useEffect(() => {
    let cancelled = false
    fetchAvailability()
      .then((s) => {
        if (!cancelled) setAvailability(s)
      })
      .catch(() => {
        /* 取得失敗時はトグル disabled のまま（安全側） */
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 対象キーが定まったらデータ取得（メモリキャッシュ・未公開は targetKey=null でフェッチしない）。
  // setState は非同期の .then 内のみ（effect 同期本体では state を触らない）。
  useEffect(() => {
    if (!targetKey || !muniCode5) return
    let cancelled = false
    const ty = effectiveSchoolType
    const key = targetKey
    fetchDistricts(muniCode5, ty)
      .then((fc) => {
        if (!cancelled) setDistricts({ key, fc })
      })
      .catch(() => {
        /* 取得失敗時は前回表示を保持（key ズレのままなので描画されない） */
      })
    return () => {
      cancelled = true
    }
  }, [targetKey, muniCode5, effectiveSchoolType])

  // 学区レイヤー（境界線＋school_name ラベル）を地図へ描画。対象キー・データ変化で貼り直す。
  useEffect(() => {
    if (typeof window === 'undefined') return
    let cancelled = false
    import('leaflet').then((L) => {
      if (cancelled) return
      const map = mapRef.current
      if (!map) return
      // 既存レイヤーを除去
      if (schoolLayerRef.current) {
        schoolLayerRef.current.remove()
        schoolLayerRef.current = null
      }
      // 対象キーと取得済みキーが一致し、フィーチャがあるときだけ描く（古い校種の残存を防ぐ）。
      if (!targetKey || !districts || districts.key !== targetKey || districts.fc.features.length === 0) return

      const group = L.layerGroup()
      // 境界線のみ（塗りなし）。fill:false・interactive:false でピンのクリックを妨げない。
      L.geoJSON(districts.fc as unknown as GeoJsonObject, {
        style: { color: SCHOOL_DISTRICT_STROKE, weight: 2, opacity: 0.9, fill: false },
        interactive: false,
      }).addTo(group)

      // SD-36: 代表点に school_name テキストラベル。
      districts.fc.features.forEach((f) => {
        const { school_name, label_lat, label_lng } = f.properties
        if (label_lat == null || label_lng == null) return
        const icon = L.divIcon({
          className: 'school-district-label',
          html: `<span>${escapeHtml(school_name)}</span>`,
        })
        L.marker([label_lat, label_lng], { icon, interactive: false, keyboard: false }).addTo(group)
      })

      group.addTo(map)
      schoolLayerRef.current = group
    })
    return () => {
      cancelled = true
    }
  }, [targetKey, districts])

  // ── 地図初期化（マウント時に1回だけ生成。破棄は最終アンマウント時のみ）──
  //
  //   以前は依存が [prefecture.code] で、都道府県を切り替えるたびに
  //   cleanup が無条件で map.remove() を呼び、地図（preferCanvas の
  //   Canvas レンダラーごと）破棄→再生成していた。直前のマーカー追加で
  //   Leaflet が予約した Canvas 再描画（requestAnimationFrame）が、破棄後の
  //   レンダラー（_ctx=undefined）に対して発火し
  //   「Cannot read properties of undefined (reading 'clearRect'/'save')」で
  //   本番クラッシュしていた（Sentry AREA-SCORE-APP-4 / AREA-SCORE-APP-5）。
  //
  //   対策：地図の生成はマウント時1回のみ。都道府県切替では破棄せず、
  //   再センタリングはマーカー描画側の fitBounds に一本化する（下の effect）。
  useEffect(() => {
    if (!containerRef.current || typeof window === 'undefined') return
    let cancelled = false

    import('leaflet').then((L) => {
      if (cancelled || mapRef.current) return
      delete (L.Icon.Default.prototype as any)._getIconUrl
      mapRef.current = L.map(containerRef.current!, {
        center: [prefecture.center_lat ?? 36.2, prefecture.center_lng ?? 138.2],
        zoom: prefecture.zoom_level ?? 9,
        zoomControl: true,
        preferCanvas: true,
      })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
        keepBuffer: 4,
      }).addTo(mapRef.current)
    })

    // コンテナのサイズ変化（モバイルの回転・レイアウト変化）で再計測。
    // 地図と同じライフサイクル（mount/unmount）で登録・解除する。
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
        markersRef.current.clear()
      }
    }
    // マウント時のみ生成（都道府県切替は下の描画 effect が setView/fitBounds で追従）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── マーカー描画（表示中の市区町村／区が変わったら再描画 + 実点へフィット）──
  useEffect(() => {
    if (typeof window === 'undefined') return
    let cancelled = false
    const baseLat = prefecture.center_lat ?? 36.2
    const baseLng = prefecture.center_lng ?? 138.2

    import('leaflet').then((L) => {
      const map = mapRef.current
      if (!map || cancelled) return

      markersRef.current.forEach((mk) => mk.remove())
      markersRef.current.clear()

      const points: [number, number][] = []
      municipalities.forEach((m, index) => {
        const heatColor = deltaColor(m.deltaRate)
        // ヒートマップ権限が無いプラン（Free/Starter）はピンを中立色にし、増減率の色情報を伏せる。
        const color = canUseHeatmap ? heatColor : NEUTRAL_MARKER_COLOR
        let lat = m.lat
        let lng = m.lng
        // 実座標（市役所・区役所代表点）を優先。無ければ中心周りに散らす。
        if (lat == null || lng == null) {
          const off = stableOffset(m.city_code ?? m.id, index)
          lat = baseLat + off.lat
          lng = baseLng + off.lng
        }

        const isSelected = m.id === selectedId
        const circle = L.circleMarker([lat, lng], {
          radius: isSelected ? 13 : 8,
          fillColor: color,
          fillOpacity: isSelected ? 0.95 : 0.75,
          color: isSelected ? '#ffffff' : color,
          weight: isSelected ? 3 : 1,
        })
        ;(circle as any)._baseColor = color

        const rateStr = m.deltaRate == null
          ? 'データなし'
          : `${m.deltaRate > 0 ? '+' : ''}${m.deltaRate.toFixed(2)}%`
        // 文字として読む増減率は「テキスト専用」のデータ色を使う（塗り=deltaColor とは別管理）。
        // globals.css の @theme が :root に出す変数を参照し、値の二重管理を避ける。
        const rateTextColor = m.deltaRate == null
          ? '#64748b'
          : m.deltaRate >= 0
            ? 'var(--color-delta-up)'
            : 'var(--color-delta-down)'
        circle.bindPopup(
          // ラベル文言は #64748b、本文（市区町村名・人口）は #0f172a。
          // 増減率の「数値」はテキスト専用データ色（rateTextColor）。ピンの塗りは heatColor のまま。
          `<div style="font-family:sans-serif;min-width:150px">
            <div style="font-weight:bold;font-size:14px;margin-bottom:4px;color:#0f172a">${m.name}</div>
            <div style="font-size:13px;color:#64748b">人口(${CENSUS.latestShort}): <b style="color:#0f172a">${formatPopulation(m.popLatest)}</b></div>
            <div style="font-size:12px;color:#64748b">増減率: <b style="color:${rateTextColor}">${rateStr}</b></div>
          </div>`,
          { className: 'muni-popup' },
        )
        circle.on('click', () => onSelectRef.current(m))
        circle.addTo(map)
        markersRef.current.set(m.id, circle)
        points.push([lat, lng])
      })

      // 実データ点の範囲へフィット（選択ではなく「表示集合」が変わったときのみ）。
      // 地図はマウント時1回生成に変わったため、都道府県切替時の再センタリングは
      // ここ（fitBounds / setView）に一本化する。二段モーションを避けるため
      // 別途の setView effect は設けない。
      if (points.length > 1) {
        map.fitBounds(points, { padding: [40, 40], maxZoom: 14, animate: false })
      } else if (points.length === 1) {
        map.setView(points[0], 13, { animate: false })
      } else {
        // 実点が0件の都道府県：旧・地図再生成時の setView 相当。府県代表中心へ寄せる。
        map.setView([baseLat, baseLng], prefecture.zoom_level ?? 9, { animate: false })
      }
    })

    return () => {
      cancelled = true
    }
    // selectedId は意図的に除外（選択でフィットし直さない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [municipalities, prefecture.code, prefecture.center_lat, prefecture.center_lng, canUseHeatmap])

  // ── 選択マーカーの強調 + パン + ポップアップ ──
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    markersRef.current.forEach((mk, id) => {
      const base = (mk as any)._baseColor as string
      const sel = id === selectedId
      mk.setRadius(sel ? 13 : 8)
      mk.setStyle({
        fillColor: base,
        fillOpacity: sel ? 0.95 : 0.75,
        color: sel ? '#ffffff' : base,
        weight: sel ? 3 : 1,
      })
      if (sel) mk.bringToFront()
    })
    if (selectedId) {
      const mk = markersRef.current.get(selectedId)
      if (mk) {
        map.panTo(mk.getLatLng(), { animate: true })
        mk.openPopup()
      }
    }
  }, [selectedId])

  // クレジット表記＝RPC が返す attribution_text をそのまま表示（UI ハードコード禁止・O27）。
  // Q-C: NULL のとき文字列 "null" を描画しない。ライセンスは muni×type 単位で均一なので先頭要素で足りる。
  const hasDistricts =
    overlayOn && !!districts && districts.key === targetKey && districts.fc.features.length > 0
  const attributionText = hasDistricts
    ? districts!.fc.features[0]?.properties.attribution_text ?? null
    : null

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      {/* 学区図トグル＋小/中切替＋未公開文言（SD-27） */}
      <SchoolDistrictControl
        overlayOn={overlayOn}
        onToggle={setOverlayOn}
        availableTypes={availableTypes}
        noMuniSelected={!muniCode5}
        schoolType={effectiveSchoolType}
        onChangeType={setSchoolType}
        showUnavailable={showUnavailable}
        loading={loadingDistricts}
      />

      {/* 免責＋クレジット：学区図ON中は地図フッターに常時表示（折りたたみ・ホバー格納は禁止） */}
      {hasDistricts && (
        <div className="absolute bottom-0 left-0 right-0 z-[1000] bg-white/95 px-3 py-1.5 text-[11px] leading-snug text-slate-500 backdrop-blur-sm border-t border-slate-200">
          {attributionText && <span className="mr-2 text-slate-600">{attributionText}</span>}
          <span>{SCHOOL_DISTRICT_DISCLAIMER}</span>
        </div>
      )}

      {/* 増減率 凡例（ヒートマップ権限のある Standard 以上のみ表示） */}
      {canUseHeatmap && (
        <div className="absolute bottom-6 left-3 sm:left-4 bg-white/95 backdrop-blur-sm border border-slate-200 rounded-lg px-3 py-2 z-[1000]">
          <div className="text-xs font-semibold text-slate-500 mb-2">人口増減率（{CENSUS.deltaRangeLabel}）</div>
          {DELTA_BUCKETS.map((b) => (
            <div key={b.label} className="flex items-center gap-2 mb-1 last:mb-0">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: b.color }} />
              <span className="text-xs text-slate-700">{b.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* ヒートマップ配色は Standard 以上（Free/Starter へのアップセル導線・D102/D75）。
          独立ブロックとして追加。既存の凡例条件式（canUseHeatmap && ...）は書き換えず、
          canUseHeatmap の算出元・型・受け渡しにも一切手を入れない（表示の追加のみ）。
          クラス構成は凡例コンテナ＋MunicipalityList の錠パターンを踏襲。 */}
      {!canUseHeatmap && (
        <div className="absolute bottom-6 left-3 sm:left-4 bg-white/95 backdrop-blur-sm border border-slate-200 rounded-lg px-3 py-2 z-[1000]">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <Lock className="w-3.5 h-3.5 text-brand-700" />
            ヒートマップ配色は Standard 以上
          </div>
          <Link
            href="/pricing"
            className="mt-1 inline-block text-xs font-semibold text-brand-700 hover:text-brand-500 transition-colors"
          >
            プランを見る
          </Link>
        </div>
      )}
    </div>
  )
}

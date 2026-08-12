'use client'

import { useEffect, useRef } from 'react'
import { Prefecture, MunicipalityWithStats } from '@/types'
import { deltaColor, DELTA_BUCKETS, formatPopulation, CENSUS } from '@/lib/census'

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

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

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
    </div>
  )
}

'use client'

import { useEffect, useRef } from 'react'
import { Prefecture, MunicipalityWithStats } from '@/types'
import { deltaColor, DELTA_BUCKETS, formatPopulation } from '@/lib/census'

interface Props {
  prefecture: Prefecture
  municipalities: MunicipalityWithStats[]
  selectedId: string | null
  onSelect: (m: MunicipalityWithStats) => void
}

// lat/lng が未登録の市区町村を都道府県中心の周りに決定論的に配置する
function stableOffset(seed: string, index: number, total: number): { lat: number; lng: number } {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0
  }
  // 同心円状に配置（人口降順で内側ほど大きい都市）
  const ring = Math.floor(index / 16)
  const angle = (index / 16) * 2 * Math.PI + (h & 0xff) * 0.012
  const radius = 0.06 + ring * 0.05
  return { lat: radius * Math.cos(angle), lng: radius * Math.sin(angle) }
}

export function MunicipalityMap({ prefecture, municipalities, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markersRef = useRef<Map<string, any>>(new Map())

  // ── 地図初期化 + 都道府県切替時のオートズーム ──
  useEffect(() => {
    if (!containerRef.current || typeof window === 'undefined') return
    const lat = prefecture.center_lat ?? 36.2
    const lng = prefecture.center_lng ?? 138.2
    const zoom = prefecture.zoom_level ?? 9

    import('leaflet').then((L) => {
      delete (L.Icon.Default.prototype as any)._getIconUrl
      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current!, {
          center: [lat, lng],
          zoom,
          zoomControl: true,
          preferCanvas: true,
        })
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors',
          maxZoom: 19,
          keepBuffer: 4,
        }).addTo(mapRef.current)
      } else {
        // 選択都道府県の範囲へオートズーム
        mapRef.current.setView([lat, lng], zoom, { animate: true })
      }
    })

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
        markersRef.current.clear()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefecture.code])

  // ── マーカー更新（増減率で色分け）──
  useEffect(() => {
    if (!mapRef.current || typeof window === 'undefined') return
    const baseLat = prefecture.center_lat ?? 36.2
    const baseLng = prefecture.center_lng ?? 138.2

    import('leaflet').then((L) => {
      if (!mapRef.current) return
      markersRef.current.forEach((mk) => mk.remove())
      markersRef.current.clear()

      municipalities.forEach((m, index) => {
        const isSelected = m.id === selectedId
        const color = deltaColor(m.deltaRate)
        let lat = m.lat
        let lng = m.lng
        if (lat == null || lng == null) {
          const off = stableOffset(m.city_code ?? m.id, index, municipalities.length)
          lat = baseLat + off.lat
          lng = baseLng + off.lng
        }

        const circle = L.circleMarker([lat, lng], {
          radius: isSelected ? 13 : 8,
          fillColor: color,
          fillOpacity: isSelected ? 0.95 : 0.75,
          color: isSelected ? '#ffffff' : color,
          weight: isSelected ? 3 : 1,
        })

        const rateStr = m.deltaRate == null
          ? 'データなし'
          : `${m.deltaRate > 0 ? '+' : ''}${m.deltaRate.toFixed(2)}%`
        circle.bindPopup(
          `<div style="font-family:sans-serif;min-width:150px">
            <div style="font-weight:bold;font-size:14px;margin-bottom:4px">${m.name}</div>
            <div style="font-size:13px">人口(2020): <b>${formatPopulation(m.pop2020)}</b></div>
            <div style="font-size:12px;color:${color}">増減率: <b>${rateStr}</b></div>
          </div>`,
          { className: 'muni-popup' }
        )
        circle.on('click', () => onSelect(m))
        circle.addTo(mapRef.current)
        markersRef.current.set(m.id, circle)
      })
    })
  }, [municipalities, selectedId, prefecture.center_lat, prefecture.center_lng, onSelect])

  // ── 選択マーカーへパン + ポップアップ ──
  useEffect(() => {
    if (!mapRef.current || !selectedId) return
    const mk = markersRef.current.get(selectedId)
    if (mk) {
      mapRef.current.panTo(mk.getLatLng(), { animate: true })
      mk.openPopup()
    }
  }, [selectedId])

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      {/* 増減率 凡例 */}
      <div className="absolute bottom-6 left-4 bg-slate-800/90 backdrop-blur-sm border border-slate-700 rounded-lg px-3 py-2 z-[1000]">
        <div className="text-xs font-semibold text-slate-400 mb-2">人口増減率（2015→2020）</div>
        {DELTA_BUCKETS.map((b) => (
          <div key={b.label} className="flex items-center gap-2 mb-1 last:mb-0">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: b.color }} />
            <span className="text-xs text-slate-300">{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

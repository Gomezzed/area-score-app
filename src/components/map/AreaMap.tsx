'use client'

import { useEffect, useRef } from 'react'
import { Area, City } from '@/types'

interface Props {
  city: City
  areas: Area[]
  selectedAreaId: string | null
  onAreaClick: (area: Area) => void
}

/** 5-tier color scale keyed on 人口増減率 */
function deltaColor(delta: number): { fill: string; border: string } {
  if (delta > 2)   return { fill: '#1d4ed8', border: '#1e3a8a' }  // fast growth  – dark blue
  if (delta > 0)   return { fill: '#60a5fa', border: '#2563eb' }  // slow growth  – light blue
  if (delta > -1)  return { fill: '#94a3b8', border: '#64748b' }  // near-zero    – gray
  if (delta > -3)  return { fill: '#fb923c', border: '#c2410c' }  // moderate dec – orange
  return            { fill: '#dc2626', border: '#991b1b' }         // fast decline – dark red
}

function stableOffset(id: string, index: number): { lat: number; lng: number } {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0
  const angle  = (index / Math.max(1, 8)) * 2 * Math.PI + (h & 0xFF) * 0.01
  const radius = 0.025 + (index % 4) * 0.015
  return { lat: radius * Math.cos(angle), lng: radius * Math.sin(angle) }
}

function fmtPop(n: number): string {
  if (Math.abs(n) >= 10000) return (n / 10000).toFixed(1) + '万'
  return n.toLocaleString()
}

const LEGEND = [
  { label: '+2% 以上（急増）',   fill: '#1d4ed8' },
  { label: '0〜+2%（増加）',     fill: '#60a5fa' },
  { label: '-1〜0%（微減）',     fill: '#94a3b8' },
  { label: '-3〜-1%（減少）',    fill: '#fb923c' },
  { label: '-3% 未満（急減）',   fill: '#dc2626' },
]

export function AreaMap({ city, areas, selectedAreaId, onAreaClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<any>(null)
  const markersRef   = useRef<any[]>([])

  // Init / re-center when city changes
  useEffect(() => {
    if (!containerRef.current || typeof window === 'undefined') return
    import('leaflet').then((L) => {
      delete (L.Icon.Default.prototype as any)._getIconUrl
      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current!, {
          center: [city.center_lat, city.center_lng],
          zoom: city.zoom_level,
          zoomControl: true,
          preferCanvas: true,
        })
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors',
          maxZoom: 19,
          keepBuffer: 4,
        }).addTo(mapRef.current)
      } else {
        mapRef.current.setView([city.center_lat, city.center_lng], city.zoom_level)
      }
    })
    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city.id])

  // Redraw markers when areas / selection changes
  useEffect(() => {
    if (!mapRef.current || typeof window === 'undefined') return
    import('leaflet').then((L) => {
      if (!mapRef.current) return
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []

      areas.forEach((area, index) => {
        const colors     = deltaColor(area.population_delta)
        const isSelected = area.id === selectedAreaId
        const sign       = area.population_delta >= 0 ? '+' : ''

        if (area.geojson) {
          const layer = L.geoJSON(area.geojson as any, {
            style: {
              fillColor:   colors.fill,
              fillOpacity: isSelected ? 0.85 : 0.55,
              color:       colors.border,
              weight:      isSelected ? 3 : 1.5,
            },
          })
          layer.on('click', () => onAreaClick(area))
          layer.addTo(mapRef.current)
          markersRef.current.push(layer)
        } else {
          const off = stableOffset(area.id, index)
          const circle = L.circleMarker(
            [city.center_lat + off.lat, city.center_lng + off.lng],
            {
              radius:      isSelected ? 16 : 12,
              fillColor:   colors.fill,
              fillOpacity: isSelected ? 0.95 : 0.75,
              color:       colors.border,
              weight:      isSelected ? 3 : 1.5,
            }
          )
          circle.bindPopup(
            `<div style="font-family:sans-serif;min-width:170px;line-height:1.5">
              <div style="font-weight:700;font-size:13px;margin-bottom:5px">${area.name}</div>
              <div style="font-size:12px;color:#374151">人口: <b>${fmtPop(area.transaction_count)}</b>人</div>
              <div style="font-size:12px;color:${colors.fill}">
                増減率: <b>${sign}${area.population_delta.toFixed(2)}%</b>
              </div>
              <div style="font-size:11px;color:#6b7280;margin-top:3px">クリックで詳細</div>
            </div>`,
            { className: 'area-popup' }
          )
          circle.on('click', () => onAreaClick(area))
          circle.addTo(mapRef.current)
          markersRef.current.push(circle)
        }
      })
    })
  }, [areas, selectedAreaId, city.center_lat, city.center_lng, onAreaClick])

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      {/* Color legend */}
      <div className="absolute bottom-6 left-4 bg-slate-900/90 backdrop-blur-sm border border-slate-700 rounded-xl px-3 py-3 z-[1000] shadow-lg">
        <div className="text-[11px] font-semibold text-slate-300 mb-2 tracking-wide">人口増減率</div>
        {LEGEND.map((item) => (
          <div key={item.label} className="flex items-center gap-2 mb-1 last:mb-0">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: item.fill }} />
            <span className="text-[11px] text-slate-300">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

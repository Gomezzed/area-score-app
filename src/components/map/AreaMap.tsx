'use client'

import { useEffect, useRef } from 'react'
import { Area, City } from '@/types'

interface Props {
  city: City
  areas: Area[]
  selectedAreaId: string | null
  onAreaClick: (area: Area) => void
}

const MAP_COLOR = { fill: '#3b82f6', border: '#2563eb' }
const MAP_COLOR_POS = { fill: '#10b981', border: '#059669' }
const MAP_COLOR_NEG = { fill: '#ef4444', border: '#dc2626' }

function stableOffset(id: string, index: number): { lat: number; lng: number } {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) | 0
  }
  const angle = (index / Math.max(1, 8)) * 2 * Math.PI + (h & 0xFF) * 0.01
  const radius = 0.025 + (index % 4) * 0.015
  return {
    lat: radius * Math.cos(angle),
    lng: radius * Math.sin(angle),
  }
}

function fmt(n: number): string {
  if (Math.abs(n) >= 10000) return (n / 10000).toFixed(1) + '万'
  return n.toLocaleString()
}

export function AreaMap({ city, areas, selectedAreaId, onAreaClick }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])

  useEffect(() => {
    if (!mapContainerRef.current || typeof window === 'undefined') return

    import('leaflet').then((L) => {
      delete (L.Icon.Default.prototype as any)._getIconUrl

      if (!mapRef.current) {
        mapRef.current = L.map(mapContainerRef.current!, {
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
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city.id])

  useEffect(() => {
    if (!mapRef.current || typeof window === 'undefined') return

    import('leaflet').then((L) => {
      if (!mapRef.current) return

      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []

      areas.forEach((area, index) => {
        const colors = area.population_delta >= 0 ? MAP_COLOR_POS : MAP_COLOR_NEG
        const isSelected = area.id === selectedAreaId

        if (area.geojson) {
          const layer = L.geoJSON(area.geojson as any, {
            style: {
              fillColor: colors.fill,
              fillOpacity: isSelected ? 0.8 : 0.5,
              color: colors.border,
              weight: isSelected ? 3 : 2,
            },
          })
          layer.on('click', () => onAreaClick(area))
          layer.addTo(mapRef.current)
          markersRef.current.push(layer)
        } else {
          const offset = stableOffset(area.id, index)
          const lat = city.center_lat + offset.lat
          const lng = city.center_lng + offset.lng

          const circle = L.circleMarker([lat, lng], {
            radius: isSelected ? 18 : 14,
            fillColor: colors.fill,
            fillOpacity: isSelected ? 0.9 : 0.7,
            color: colors.border,
            weight: isSelected ? 3 : 2,
          })

          circle.bindPopup(
            `<div style="font-family:sans-serif;min-width:160px">
              <div style="font-weight:bold;font-size:14px;margin-bottom:6px">${area.name}</div>
              <div style="font-size:12px;color:#555;margin-bottom:4px">
                人口: ${fmt(area.transaction_count)}人
              </div>
              <div style="font-size:12px;color:${area.population_delta >= 0 ? '#10b981' : '#ef4444'}">
                ${area.population_delta > 0 ? '+' : ''}${area.population_delta.toFixed(2)}%
              </div>
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
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* 凡例 */}
      <div className="absolute bottom-6 left-4 bg-slate-800/90 backdrop-blur-sm border border-slate-700 rounded-lg px-3 py-2 z-[1000]">
        <div className="text-xs font-semibold text-slate-400 mb-2">人口増減</div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: MAP_COLOR_POS.fill }} />
          <span className="text-xs text-slate-300">増加</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: MAP_COLOR_NEG.fill }} />
          <span className="text-xs text-slate-300">減少</span>
        </div>
      </div>
    </div>
  )
}

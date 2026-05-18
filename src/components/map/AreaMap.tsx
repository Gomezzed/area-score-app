'use client'

import { useEffect, useRef } from 'react'
import { Area, City, Tier } from '@/types'

interface Props {
  city: City
  areas: Area[]
  selectedAreaId: string | null
  onAreaClick: (area: Area) => void
}

const TIER_COLORS: Record<Tier, { fill: string; border: string }> = {
  A: { fill: '#10b981', border: '#059669' },
  B: { fill: '#f59e0b', border: '#d97706' },
  C: { fill: '#ef4444', border: '#dc2626' },
}

// Leaflet requires window, so we load it dynamically
export function AreaMap({ city, areas, selectedAreaId, onAreaClick }: Props) {
  const mapRef = useRef<HTMLDivElement>(null)
  const leafletMapRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])

  useEffect(() => {
    if (!mapRef.current || typeof window === 'undefined') return

    // Dynamic import of Leaflet (client-side only)
    import('leaflet').then((L) => {
      // Fix default icon issue with Next.js
      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      if (!leafletMapRef.current) {
        leafletMapRef.current = L.map(mapRef.current!, {
          center: [city.center_lat, city.center_lng],
          zoom: city.zoom_level,
          zoomControl: true,
        })

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors',
          maxZoom: 19,
        }).addTo(leafletMapRef.current)
      } else {
        leafletMapRef.current.setView([city.center_lat, city.center_lng], city.zoom_level)
      }

      // Clear existing markers
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []

      areas.forEach((area) => {
        const tier = area.tier as Tier
        const colors = TIER_COLORS[tier]
        const isSelected = area.id === selectedAreaId

        if (area.geojson) {
          // Use GeoJSON polygon if available
          const layer = L.geoJSON(area.geojson as any, {
            style: {
              fillColor: colors.fill,
              fillOpacity: isSelected ? 0.8 : 0.5,
              color: colors.border,
              weight: isSelected ? 3 : 2,
            },
          })
          layer.on('click', () => onAreaClick(area))
          layer.addTo(leafletMapRef.current)
          markersRef.current.push(layer)
        } else {
          // Fallback: circle marker at city center with offset
          const index = areas.indexOf(area)
          const lat = city.center_lat + (Math.random() - 0.5) * 0.08
          const lng = city.center_lng + (Math.random() - 0.5) * 0.08

          const circle = L.circleMarker([lat, lng], {
            radius: isSelected ? 18 : 14,
            fillColor: colors.fill,
            fillOpacity: isSelected ? 0.9 : 0.7,
            color: colors.border,
            weight: isSelected ? 3 : 2,
          })

          const popup = L.popup({ className: 'area-popup' }).setContent(`
            <div style="font-family:sans-serif;min-width:160px">
              <div style="font-weight:bold;font-size:14px;margin-bottom:6px">${area.name}</div>
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                <span style="background:${colors.fill};color:white;padding:1px 8px;border-radius:4px;font-size:11px;font-weight:bold">Tier ${tier}</span>
                <span style="font-size:13px;font-weight:bold">${area.score.toFixed(1)}pt</span>
              </div>
              <div style="font-size:11px;color:#666">
                取引: ${area.transaction_count}件 ｜ 人口: ${area.population_delta > 0 ? '+' : ''}${area.population_delta.toFixed(1)}%
              </div>
            </div>
          `)

          circle.bindPopup(popup)
          circle.on('click', () => onAreaClick(area))
          circle.addTo(leafletMapRef.current)
          markersRef.current.push(circle)
        }
      })
    })

    return () => {
      if (leafletMapRef.current && mapRef.current === null) {
        leafletMapRef.current.remove()
        leafletMapRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, areas, selectedAreaId])

  return (
    <div className="relative w-full h-full">
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        crossOrigin=""
      />
      <div ref={mapRef} className="w-full h-full rounded-lg" />

      {/* Tier Legend */}
      <div className="absolute bottom-6 left-4 bg-slate-800/90 backdrop-blur-sm border border-slate-700 rounded-lg px-3 py-2 z-[1000]">
        <div className="text-xs font-semibold text-slate-400 mb-2">Tier 凡例</div>
        {(['A', 'B', 'C'] as Tier[]).map((tier) => (
          <div key={tier} className="flex items-center gap-2 mb-1 last:mb-0">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: TIER_COLORS[tier].fill }}
            />
            <span className="text-xs text-slate-300">Tier {tier}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

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

// area.id から決定論的なオフセットを生成（Math.random()を排除）
function stableOffset(id: string, index: number): { lat: number; lng: number } {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) | 0
  }
  // 螺旋状に配置してオーバーラップを減らす
  const angle = (index / Math.max(1, 8)) * 2 * Math.PI + (h & 0xFF) * 0.01
  const radius = 0.025 + (index % 4) * 0.015
  return {
    lat: radius * Math.cos(angle),
    lng: radius * Math.sin(angle),
  }
}

export function AreaMap({ city, areas, selectedAreaId, onAreaClick }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)       // Leaflet Map インスタンス
  const markersRef = useRef<any[]>([])   // 現在のマーカー一覧

  // ── エフェクト1: 地図の初期化（cityが変わったときだけ）──
  useEffect(() => {
    if (!mapContainerRef.current || typeof window === 'undefined') return

    import('leaflet').then((L) => {
      // アイコン修正（Next.js環境でのデフォルトアイコン問題）
      delete (L.Icon.Default.prototype as any)._getIconUrl

      if (!mapRef.current) {
        mapRef.current = L.map(mapContainerRef.current!, {
          center: [city.center_lat, city.center_lng],
          zoom: city.zoom_level,
          zoomControl: true,
          preferCanvas: true, // Canvas描画でパフォーマンス向上
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
      // アンマウント時のみ破棄
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city.id]) // city.id が変わった時だけ再初期化

  // ── エフェクト2: マーカーの更新（areas / selectedAreaId が変わったとき）──
  useEffect(() => {
    if (!mapRef.current || typeof window === 'undefined') return

    import('leaflet').then((L) => {
      if (!mapRef.current) return

      // 既存マーカーを削除
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []

      areas.forEach((area, index) => {
        const tier = area.tier as Tier
        const colors = TIER_COLORS[tier]
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
          // GeoJSONなし → 決定論的なオフセットで円マーカー
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
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                <span style="background:${colors.fill};color:white;padding:1px 8px;border-radius:4px;font-size:11px;font-weight:bold">Tier ${tier}</span>
                <span style="font-size:13px;font-weight:bold">${area.score.toFixed(1)}pt</span>
              </div>
              <div style="font-size:11px;color:#888">
                取引: ${area.transaction_count}件 ｜ 人口: ${area.population_delta > 0 ? '+' : ''}${area.population_delta.toFixed(1)}%
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
      {/* Leaflet CSS は layout.tsx でグローバル読み込み済み */}
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Tier 凡例 */}
      <div className="absolute bottom-6 left-4 bg-slate-800/90 backdrop-blur-sm border border-slate-700 rounded-lg px-3 py-2 z-[1000]">
        <div className="text-xs font-semibold text-slate-400 mb-2">Tier 凡例</div>
        {(['A', 'B', 'C'] as Tier[]).map((tier) => (
          <div key={tier} className="flex items-center gap-2 mb-1 last:mb-0">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: TIER_COLORS[tier].fill }} />
            <span className="text-xs text-slate-300">Tier {tier}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

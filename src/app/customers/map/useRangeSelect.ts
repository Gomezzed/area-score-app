'use client'

// =====================================================================
// 校区ヒートマップ PDF「出力範囲の指定」フック（PR-B）。
//   右パネルの状態（校区種別は表示のみ・出力範囲・ユーザー指定サブ選択・市外を薄くする）と、
//   3 つのユーザー指定モードの Leaflet 側配線・後始末を1箇所に閉じる。
//     - 矩形ドラッグ：dragging.disable + crosshair + mousedown/move/up の破線プレビュー
//     - 地図を動かして指定：パネルを畳み、押した時点の map.getBounds()
//     - 校区をクリック：ポリゴンの click を「選択/解除」に切替（詳細パネルは開かない）
//   幾何は @/lib/heatmap-pdf/range（純関数）へ委譲する。
//   ⛔ モード解除・パネル閉で必ず元に戻す（dragging・カーソル・矩形・ポリゴン style・
//      クリック挙動・中心/ズーム）。既存 click ハンドラの意味は変えない（モード中ガードのみ）。
// =====================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type {
  GeoJSON as LeafletGeoJSON,
  Layer,
  LeafletMouseEvent,
  Map as LeafletMap,
  PathOptions,
  Rectangle,
} from 'leaflet'
import {
  boundsFromFeatures,
  boundsFromTargetFeatures,
  centerOfBounds,
  isRectTooSmall,
  normalizeRect,
  type Bounds,
  type IdentifiedFeatureLike,
  type LngLat,
} from '@/lib/heatmap-pdf/range'
import type { FeatureLike } from '@/lib/heatmap-pdf/mask-path'

// 'fit'＝濃淡のある校区に合わせる（既定）。並び順は fit → current → auto → user。
export type RangeMode = 'fit' | 'current' | 'auto' | 'user'
export type UserSubMode = 'rect' | 'move' | 'click'

// 既定の出力範囲モード＝「濃淡のある校区に合わせる」。
const DEFAULT_RANGE_MODE: RangeMode = 'fit'
// 「市外を薄くする」の既定 ON になるモード（自動調整・濃淡フィット）。
function defaultMaskFor(mode: RangeMode): boolean {
  return mode === 'auto' || mode === 'fit'
}

// ポリゴンからは突合キー id しか使わない（tier 以外の値は載せない）。
type DistrictFeature = Feature<Geometry, { id: string }>

// 選択強調の境界線太さ。tierToPathStyle の base weight=1 に +2（要件）。
const SELECTED_WEIGHT = 3
// 矩形プレビュー（破線・塗りなし）。確定後は実線に切替。
const RECT_STYLE_DRAW: PathOptions = { color: '#2e5480', weight: 2, dashArray: '6 4', fill: false }
const RECT_STYLE_DONE: PathOptions = { color: '#2e5480', weight: 2, fill: false }

export interface UseRangeSelectParams {
  mapRef: React.MutableRefObject<LeafletMap | null>
  layerRef: React.MutableRefObject<LeafletGeoJSON | null>
  containerRef: React.RefObject<HTMLDivElement | null>
  geojson: FeatureCollection<Geometry, { id: string }> | null
  mapReady: boolean
  // 「濃淡のある校区」判定（page.tsx の tierById.has(id) を注入）。安定参照を渡すこと。
  isTargetDistrict: (id: string) => boolean
}

export interface ResolvedRange {
  bounds: Bounds
  center: LngLat
  maskOutside: boolean
}

export function useRangeSelect({
  mapRef,
  layerRef,
  containerRef,
  geojson,
  mapReady,
  isTargetDistrict,
}: UseRangeSelectParams) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [rangeMode, setRangeMode] = useState<RangeMode>(DEFAULT_RANGE_MODE)
  const [userSubMode, setUserSubMode] = useState<UserSubMode | null>(null)
  const [maskOutside, setMaskOutside] = useState(defaultMaskFor(DEFAULT_RANGE_MODE))
  // 校区種別の出力モード（PR-C）。false＝現在の種別のみ（既定）／true＝小学校区＋中学校区（左右2パネル）。
  //   他方校種の取得・0件フォールバックは page.tsx（データ層）が扱う。ここは UI トグルのみ保持。
  const [bothMode, setBothMode] = useState(false)
  // 矩形ドラッグの確定可否／極小無効フラグ。
  const [rectConfirmable, setRectConfirmable] = useState(false)
  const [rectInvalid, setRectInvalid] = useState(false)
  // 「N校区を選択中」。
  const [selectedCount, setSelectedCount] = useState(0)

  // Leaflet 側の可変状態（描画・選択・後始末）。
  const rectLayerRef = useRef<Rectangle | null>(null)
  const rectBoundsRef = useRef<Bounds | null>(null)
  const selectionActiveRef = useRef(false)
  const selectedRef = useRef<Map<string, { feature: DistrictFeature; layer: Layer }>>(new Map())
  // 現在アクティブなモードの後始末関数（モード切替・パネル閉で必ず呼ぶ）。
  const teardownRef = useRef<(() => void) | null>(null)
  // パネルを開いた時点の中心・ズーム（出力後・キャンセル後に戻す）。
  const viewSnapRef = useRef<{ center: LngLat; zoom: number } | null>(null)

  // 「濃淡のある校区に合わせる」の bounds（対象＝濃淡付きのみ・外接矩形＋4% 余白）。
  //   対象 0 件なら null で、resolveRange/canExport が「現在表示中」へフォールバックする。
  const fitBounds = useMemo<Bounds | null>(() => {
    if (!geojson) return null
    return boundsFromTargetFeatures(
      geojson.features as unknown as IdentifiedFeatureLike[],
      isTargetDistrict,
    )
  }, [geojson, isTargetDistrict])
  const fitHasTargets = fitBounds !== null

  // 矩形プレビューを消す。
  const clearRectPreview = useCallback(() => {
    if (rectLayerRef.current) {
      rectLayerRef.current.remove()
      rectLayerRef.current = null
    }
  }, [])

  // 選択強調をすべて解除する（resetStyle で style 関数の出力へ戻す）。
  const clearSelection = useCallback(() => {
    const layer = layerRef.current
    selectedRef.current.forEach(({ layer: lyr }) => {
      try {
        layer?.resetStyle?.(lyr)
      } catch {
        /* レイヤー再生成後の stale は無視 */
      }
    })
    selectedRef.current.clear()
    setSelectedCount(0)
  }, [layerRef])

  // ── アクティブなユーザー指定モードの配線／後始末（モード変更で張り替え）──
  useEffect(() => {
    if (!mapReady) return
    const map = mapRef.current
    if (!map) return
    const active: UserSubMode | null = rangeMode === 'user' ? userSubMode : null
    let disposed = false

    const setupRect = (L: typeof import('leaflet')) => {
      const container = containerRef.current
      map.dragging.disable()
      if (container) container.style.cursor = 'crosshair'
      let drawing = false
      let startLL: LngLat | null = null
      let startX = 0
      let startY = 0

      const onDown = (e: LeafletMouseEvent) => {
        setRectConfirmable(false)
        setRectInvalid(false)
        rectBoundsRef.current = null
        clearRectPreview()
        drawing = true
        startLL = { lng: e.latlng.lng, lat: e.latlng.lat }
        startX = e.containerPoint.x
        startY = e.containerPoint.y
      }
      const onMove = (e: LeafletMouseEvent) => {
        if (!drawing || !startLL) return
        const b = normalizeRect(startLL, { lng: e.latlng.lng, lat: e.latlng.lat })
        clearRectPreview()
        rectLayerRef.current = L.rectangle(
          [
            [b.south, b.west],
            [b.north, b.east],
          ],
          RECT_STYLE_DRAW,
        ).addTo(map)
      }
      const onUp = (e: LeafletMouseEvent) => {
        if (!drawing || !startLL) return
        drawing = false
        const dx = e.containerPoint.x - startX
        const dy = e.containerPoint.y - startY
        // 幅または高さが 20px 未満は無効として再操作を促す。
        if (isRectTooSmall(dx, dy)) {
          clearRectPreview()
          rectBoundsRef.current = null
          setRectInvalid(true)
          setRectConfirmable(false)
          return
        }
        const b = normalizeRect(startLL, { lng: e.latlng.lng, lat: e.latlng.lat })
        rectBoundsRef.current = b
        clearRectPreview()
        rectLayerRef.current = L.rectangle(
          [
            [b.south, b.west],
            [b.north, b.east],
          ],
          RECT_STYLE_DONE,
        ).addTo(map)
        setRectInvalid(false)
        setRectConfirmable(true)
      }

      map.on('mousedown', onDown)
      map.on('mousemove', onMove)
      map.on('mouseup', onUp)
      teardownRef.current = () => {
        map.off('mousedown', onDown)
        map.off('mousemove', onMove)
        map.off('mouseup', onUp)
        clearRectPreview()
        rectBoundsRef.current = null
        map.dragging.enable()
        if (container) container.style.cursor = ''
      }
    }

    if (active === 'rect') {
      // L.rectangle のために leaflet を読む（未ロードなら import 後に配線）。
      import('leaflet').then((L) => {
        if (!disposed) setupRect(L)
      })
    } else if (active === 'click') {
      selectionActiveRef.current = true
      teardownRef.current = () => {
        selectionActiveRef.current = false
        clearSelection()
      }
    } else {
      teardownRef.current = null
    }

    return () => {
      disposed = true
      if (teardownRef.current) {
        teardownRef.current()
        teardownRef.current = null
      }
      setRectConfirmable(false)
      setRectInvalid(false)
    }
  }, [rangeMode, userSubMode, mapReady, mapRef, containerRef, clearRectPreview, clearSelection])

  // ── ESC でユーザー指定モードを解除（＝既定「濃淡のある校区に合わせる」へ戻す）──
  useEffect(() => {
    if (!panelOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && rangeMode === 'user') {
        setRangeMode(DEFAULT_RANGE_MODE)
        setUserSubMode(null)
        setMaskOutside(defaultMaskFor(DEFAULT_RANGE_MODE))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panelOpen, rangeMode])

  // ポリゴン click のモード中ガード。選択モードなら「選択/解除」を行い true（消費）を返す。
  //   ⛔ 選択モードでないときは false を返し、既存の詳細パネル動作をそのまま通す（意味を変えない）。
  const handlePolygonClick = useCallback(
    (feature: DistrictFeature, layer: Layer): boolean => {
      if (!selectionActiveRef.current) return false
      const id = feature.properties?.id
      if (id == null) return true
      const sel = selectedRef.current
      if (sel.has(id)) {
        sel.delete(id)
        try {
          layerRef.current?.resetStyle?.(layer)
        } catch {
          /* noop */
        }
      } else {
        sel.set(id, { feature, layer })
        try {
          ;(layer as unknown as { setStyle?: (o: PathOptions) => void }).setStyle?.({
            weight: SELECTED_WEIGHT,
          })
          ;(layer as unknown as { bringToFront?: () => void }).bringToFront?.()
        } catch {
          /* noop */
        }
      }
      setSelectedCount(sel.size)
      return true
    },
    [layerRef],
  )

  // 出力範囲（bounds / center / maskOutside）を現在のモードから解決する。
  //   center はタイル配置の中心。範囲モードは bounds の中点、「現在表示中」は map の中心。
  const resolveRange = useCallback((): ResolvedRange | null => {
    const map = mapRef.current
    if (!map) return null

    // 濃淡フィット：対象があればその bounds、無ければ「現在表示中」へフォールバック。
    if (rangeMode === 'fit' && fitBounds) {
      return { bounds: fitBounds, center: centerOfBounds(fitBounds), maskOutside }
    }

    // 現在表示中（および濃淡フィットで対象 0 件のフォールバック）。
    if (rangeMode === 'current' || rangeMode === 'fit') {
      const b = map.getBounds()
      const c = map.getCenter()
      return {
        bounds: { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
        center: { lng: c.lng, lat: c.lat },
        maskOutside,
      }
    }

    let bounds: Bounds | null = null
    if (rangeMode === 'auto') {
      bounds = geojson
        ? boundsFromFeatures(geojson.features as unknown as FeatureLike[])
        : null
    } else if (userSubMode === 'rect') {
      bounds = rectBoundsRef.current
    } else if (userSubMode === 'move') {
      const b = map.getBounds()
      bounds = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }
    } else if (userSubMode === 'click') {
      const feats = [...selectedRef.current.values()].map((v) => v.feature)
      bounds = boundsFromFeatures(feats as unknown as FeatureLike[])
    }
    if (!bounds) return null
    return { bounds, center: centerOfBounds(bounds), maskOutside }
  }, [rangeMode, userSubMode, geojson, maskOutside, mapRef, fitBounds])

  // 出力ボタンの活性条件（範囲が確定しているか）。
  const canExport = (() => {
    // 濃淡フィットは対象 0 件でも「現在表示中」へフォールバックするため常に出力可。
    if (rangeMode === 'fit') return true
    if (rangeMode === 'current') return true
    if (rangeMode === 'auto') return (geojson?.features.length ?? 0) > 0
    if (userSubMode === 'rect') return rectConfirmable
    if (userSubMode === 'move') return true
    if (userSubMode === 'click') return selectedCount > 0
    return false
  })()

  // 出力範囲ラジオの選択。濃淡フィット・自動調整=既定 ON、他=既定 OFF（この後ユーザーが切替可）。
  const selectRangeMode = useCallback((m: RangeMode) => {
    setRangeMode(m)
    setMaskOutside(defaultMaskFor(m))
    setUserSubMode(m === 'user' ? 'rect' : null)
  }, [])

  const selectUserSubMode = useCallback((s: UserSubMode) => {
    setUserSubMode(s)
  }, [])

  // 矩形をやり直す（矩形モードは維持したままプレビューと確定を破棄）。
  const redoRect = useCallback(() => {
    clearRectPreview()
    rectBoundsRef.current = null
    setRectConfirmable(false)
    setRectInvalid(false)
  }, [clearRectPreview])

  // パネルを開く：中心・ズームを控え、既定（現在表示中・マスク OFF）に戻す。
  const openPanel = useCallback(() => {
    const map = mapRef.current
    if (map) {
      const c = map.getCenter()
      viewSnapRef.current = { center: { lng: c.lng, lat: c.lat }, zoom: map.getZoom() }
    }
    setRangeMode(DEFAULT_RANGE_MODE)
    setUserSubMode(null)
    setMaskOutside(defaultMaskFor(DEFAULT_RANGE_MODE))
    setBothMode(false)
    setRectConfirmable(false)
    setRectInvalid(false)
    setPanelOpen(true)
  }, [mapRef])

  // パネルを閉じる：モードを解除（effect の後始末が走る）し、中心・ズームを復帰。
  const closePanel = useCallback(() => {
    setPanelOpen(false)
    setRangeMode(DEFAULT_RANGE_MODE)
    setUserSubMode(null)
    setMaskOutside(defaultMaskFor(DEFAULT_RANGE_MODE))
    setBothMode(false)
    setRectConfirmable(false)
    setRectInvalid(false)
    const map = mapRef.current
    const snap = viewSnapRef.current
    if (map && snap) {
      try {
        map.setView([snap.center.lat, snap.center.lng], snap.zoom, { animate: false })
      } catch {
        /* 復帰に失敗しても地図は残す */
      }
    }
  }, [mapRef])

  // 移動確定モードではパネルを畳み、下部バーを出す。
  const panelCollapsed = rangeMode === 'user' && userSubMode === 'move'

  return {
    // 状態
    panelOpen,
    panelCollapsed,
    rangeMode,
    userSubMode,
    maskOutside,
    rectConfirmable,
    rectInvalid,
    selectedCount,
    fitHasTargets,
    canExport,
    bothMode,
    // 操作
    openPanel,
    closePanel,
    selectRangeMode,
    selectUserSubMode,
    setMaskOutside,
    setBothMode,
    redoRect,
    handlePolygonClick,
    resolveRange,
  }
}

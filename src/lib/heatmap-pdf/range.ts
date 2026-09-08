// =====================================================================
// 校区ヒートマップ PDF 出力範囲の幾何（純ロジック・依存ゼロ）。
//   ユーザー指定（矩形ドラッグ／地図移動／校区クリック）と「{muni}全体に自動調整」の
//   bounds を組む純関数群。
//     - normalizeRect: 2 隅からドラッグ方向に依らない bounds を作る
//     - unionBounds: 複数 bounds の外接矩形
//     - boundsFromFeatures: feature 群の外接矩形（自動調整＝読み込み済み全 feature）
//     - centerOfBounds: bounds の中点（タイル配置の center に使う）
//     - isRectTooSmall: 極小ドラッグ（幅/高さ 20px 未満）の無効判定
//     - padBounds: bounds を上下左右 frac 倍の余白で広げる
//     - boundsFromTargetFeatures: 対象校区（濃淡付き）の外接矩形＋4% 余白（0 件は null）
//   ⚠ 外部 import を持たない（型・関数は自モジュールと ./mask-path.ts の純関数のみ）。
//   ⛔ 自動調整は tier で feature を絞らない（抑止校区の露出防止・Q-2/補足1）。
//   ⛔ 「濃淡のある校区に合わせる」は逆に濃淡付き（＝ランキングに載った）校区のみを対象にする。
//      抑止校区（k=5）・反響ゼロは SD-38 により画面上区別できないため含めない。判定述語は注入する。
// =====================================================================

import { collectPolygonRings, type FeatureLike } from './mask-path.ts'

// 突合キー id を併せ持つ feature の最小構造型（対象抽出の述語注入に使う）。
export interface IdentifiedFeatureLike extends FeatureLike {
  properties?: { id?: string | null } | null
}

// tiles.ts / geometry.ts と同形（構造的に互換）。ここでは独立に持つ。
export interface Bounds {
  west: number
  south: number
  east: number
  north: number
}
export interface LngLat {
  lng: number
  lat: number
}

// 2 隅（lng/lat）から bounds を作る。どの方向にドラッグしても同じ bounds になる（正規化）。
export function normalizeRect(a: LngLat, b: LngLat): Bounds {
  return {
    west: Math.min(a.lng, b.lng),
    east: Math.max(a.lng, b.lng),
    south: Math.min(a.lat, b.lat),
    north: Math.max(a.lat, b.lat),
  }
}

// 複数 bounds の外接矩形（union）。空配列は null。
export function unionBounds(list: Bounds[]): Bounds | null {
  if (list.length === 0) return null
  let { west, south, east, north } = list[0]
  for (let i = 1; i < list.length; i++) {
    const b = list[i]
    if (b.west < west) west = b.west
    if (b.south < south) south = b.south
    if (b.east > east) east = b.east
    if (b.north > north) north = b.north
  }
  return { west, south, east, north }
}

// feature 群（Polygon/MultiPolygon）の外接矩形。リングが 1 点も無ければ null。
//   ⛔ tier・公開状態で絞らない。渡された全 feature を使う（自動調整＝読み込み済み全 feature）。
export function boundsFromFeatures(features: FeatureLike[]): Bounds | null {
  const rings = collectPolygonRings(features)
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  let seen = false
  for (const ring of rings) {
    for (const point of ring) {
      const lng = point[0]
      const lat = point[1]
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
      seen = true
      if (lng < west) west = lng
      if (lng > east) east = lng
      if (lat < south) south = lat
      if (lat > north) north = lat
    }
  }
  return seen ? { west, south, east, north } : null
}

// bounds の中点（PDF タイル配置の center に使う）。
export function centerOfBounds(b: Bounds): LngLat {
  return { lng: (b.west + b.east) / 2, lat: (b.south + b.north) / 2 }
}

// 極小ドラッグ判定。幅または高さが min（既定 20）px 未満なら無効。
export function isRectTooSmall(widthPx: number, heightPx: number, minPx = 20): boolean {
  return Math.abs(widthPx) < minPx || Math.abs(heightPx) < minPx
}

// bounds を上下左右それぞれ frac 倍の余白で広げる。span=0（1 点）なら余白 0（縮退のまま）。
export function padBounds(b: Bounds, frac: number): Bounds {
  const spanX = b.east - b.west
  const spanY = b.north - b.south
  return {
    west: b.west - spanX * frac,
    east: b.east + spanX * frac,
    south: b.south - spanY * frac,
    north: b.north + spanY * frac,
  }
}

// 対象校区（濃淡付き＝ランキング取得結果に含まれる校区）の外接矩形に padFrac（既定 4%）の余白を足す。
//   isTarget は page.tsx の単一述語 tierById.has(id) を引数注入する（PDF 側で tier 条件を新設しない）。
//   ⛔ 抑止校区（k=5）・反響ゼロは含めない。SD-38 により両者は画面上区別できないため、
//      濃淡が付いた（＝ランキングに載った）校区だけを対象とする。
//   対象が 0 件（リングが 1 点も無い）なら null（呼び出し側で「現在表示中」へフォールバック）。
export function boundsFromTargetFeatures(
  features: IdentifiedFeatureLike[],
  isTarget: (id: string) => boolean,
  padFrac = 0.04,
): Bounds | null {
  const targets = features.filter((f) => {
    const id = f.properties?.id
    return typeof id === 'string' && isTarget(id)
  })
  const raw = boundsFromFeatures(targets)
  return raw ? padBounds(raw, padFrac) : null
}

// =====================================================================
// 校区ヒートマップ PDF「市外を薄くする」マスク幾何（純ロジック・依存ゼロ）。
//   読み込み済み全 feature の Polygon/MultiPolygon リングを収集し、
//   フレーム矩形＋全リングを 1 つの even-odd パス（合併形の外側だけ塗る）に
//   組み立てるための順序付きリング列を返す。
//   ⚠ 外部 import を持たない（テストは node --test で相対 import・@/ 不使用）。
//   ⛔ tier の有無で feature を絞らない（抑止校区・tier 無しの校区も含む・補足1）。
//   投影は呼び出し側（render.ts）で行い、px 座標を注入する（ここは座標系に非依存）。
// =====================================================================

// GeoJSON への型依存を持たないための最小の構造型。
export interface GeometryLike {
  type: string
  coordinates: unknown
}
export interface FeatureLike {
  geometry: GeometryLike | null
}

// [lng, lat] の並び（1 リング）。
export type Ring = number[][]

// Polygon / MultiPolygon から全リング（外環＋穴）を取り出す。それ以外の型は無視。
function ringsOfGeometry(geom: GeometryLike | null): Ring[] {
  if (!geom) return []
  if (geom.type === 'Polygon') {
    return (geom.coordinates as number[][][]) ?? []
  }
  if (geom.type === 'MultiPolygon') {
    const out: Ring[] = []
    for (const polygon of (geom.coordinates as number[][][][]) ?? []) {
      for (const ring of polygon) out.push(ring)
    }
    return out
  }
  return []
}

// 読み込み済み全 feature の Polygon/MultiPolygon リングを収集する。
//   ⛔ tier や公開状態で絞らない。渡された feature をそのまま全て使う（補足1）。
export function collectPolygonRings(features: FeatureLike[]): Ring[] {
  const rings: Ring[] = []
  for (const f of features) {
    for (const ring of ringsOfGeometry(f.geometry)) rings.push(ring)
  }
  return rings
}

// even-odd マスクの順序付きリング列。先頭がフレーム矩形、以降が校区リング（すべて px）。
export interface MaskPath {
  rings: number[][][]
}

// フレーム矩形（4 頂点の px）＋投影済み校区リング群を 1 本の even-odd パスへまとめる。
//   even-odd 規則により「フレーム ∖ 校区合併形」＝校区の外側だけが塗り対象になる。
//   ⚠ 純：ctx に触れない。リングの順序と点だけを返し、描画は呼び出し側が行う。
export function buildMaskPath(frameCorners: number[][], featureRingsPx: number[][][]): MaskPath {
  return {
    rings: [frameCorners, ...featureRingsPx],
  }
}

// マスクパスの総点数（テスト・検証用の決定的な集計）。
export function maskPointCount(path: MaskPath): number {
  return path.rings.reduce((sum, ring) => sum + ring.length, 0)
}

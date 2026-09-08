// 校区ヒートマップ PDF 出力範囲の幾何（純ロジック）のユニットテスト。依存ゼロ。
//   ⚠ 相対 import は .ts 拡張子を明示。@/ は使わない。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeRect,
  unionBounds,
  boundsFromFeatures,
  centerOfBounds,
  isRectTooSmall,
} from './range.ts'
import type { FeatureLike } from './mask-path.ts'

test('normalizeRect: どの方向にドラッグしても同じ bounds（正規化）', () => {
  const expected = { west: 138, east: 139, south: 35, north: 36 }
  const corners = [
    [
      { lng: 138, lat: 35 },
      { lng: 139, lat: 36 },
    ],
    [
      { lng: 139, lat: 36 },
      { lng: 138, lat: 35 },
    ],
    [
      { lng: 138, lat: 36 },
      { lng: 139, lat: 35 },
    ],
    [
      { lng: 139, lat: 35 },
      { lng: 138, lat: 36 },
    ],
  ]
  for (const [a, b] of corners) {
    assert.deepEqual(normalizeRect(a, b), expected)
  }
})

test('unionBounds: 複数 bounds の外接矩形／単一は同値／空は null', () => {
  const b1 = { west: 138, east: 139, south: 35, north: 36 }
  const b2 = { west: 137.5, east: 138.5, south: 35.5, north: 37 }
  assert.deepEqual(unionBounds([b1, b2]), {
    west: 137.5,
    east: 139,
    south: 35,
    north: 37,
  })
  assert.deepEqual(unionBounds([b1]), b1)
  assert.equal(unionBounds([]), null)
})

test('boundsFromFeatures: 全 feature の外接矩形（tier で絞らない）', () => {
  const features: FeatureLike[] = [
    {
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [138, 35],
            [139, 35],
            [139, 36],
            [138, 35],
          ],
        ],
      },
    },
    {
      // tier 無し相当の校区も外接矩形に含める（抑止校区の露出防止・補足1）
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [137, 34],
              [137.5, 34],
              [137, 34.5],
              [137, 34],
            ],
          ],
        ],
      },
    },
    { geometry: null },
  ]
  assert.deepEqual(boundsFromFeatures(features), {
    west: 137,
    east: 139,
    south: 34,
    north: 36,
  })
})

test('boundsFromFeatures: リングが無ければ null', () => {
  assert.equal(boundsFromFeatures([]), null)
  assert.equal(boundsFromFeatures([{ geometry: null }]), null)
  assert.equal(
    boundsFromFeatures([{ geometry: { type: 'Point', coordinates: [1, 2] } }]),
    null,
  )
})

test('centerOfBounds: bounds の中点', () => {
  assert.deepEqual(
    centerOfBounds({ west: 138, east: 139, south: 35, north: 37 }),
    { lng: 138.5, lat: 36 },
  )
})

test('isRectTooSmall: 幅または高さが 20px 未満は無効', () => {
  assert.equal(isRectTooSmall(19, 100), true)
  assert.equal(isRectTooSmall(100, 19), true)
  assert.equal(isRectTooSmall(20, 20), false)
  assert.equal(isRectTooSmall(100, 100), false)
  // 負の差（方向）でも絶対値で判定
  assert.equal(isRectTooSmall(-19, -100), true)
  assert.equal(isRectTooSmall(-30, -30), false)
  // しきい値は注入可能
  assert.equal(isRectTooSmall(25, 25, 30), true)
})

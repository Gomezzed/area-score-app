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
  padBounds,
  boundsFromTargetFeatures,
  type IdentifiedFeatureLike,
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

test('padBounds: 上下左右に span の frac 倍を足す（span=0 は縮退のまま）', () => {
  assert.deepEqual(padBounds({ west: 138, east: 139, south: 35, north: 37 }, 0.04), {
    west: 137.96,
    east: 139.04,
    south: 34.92,
    north: 37.08,
  })
  // 1 点（span=0）なら余白は 0（そのまま）
  assert.deepEqual(padBounds({ west: 138, east: 138, south: 35, north: 35 }, 0.04), {
    west: 138,
    east: 138,
    south: 35,
    north: 35,
  })
})

// 対象抽出＋4% 余白の共通フィクスチャ（id 併せ持ち・述語で絞る）。
const TARGET_FEATURES: IdentifiedFeatureLike[] = [
  {
    // a：対象（濃淡付き）
    properties: { id: 'a' },
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
    // b：非対象（抑止/反響ゼロ相当）。遠方に置き、混入したら bounds が壊れることで検知する。
    properties: { id: 'b' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [100, 10],
          [101, 10],
          [101, 11],
          [100, 10],
        ],
      ],
    },
  },
  {
    // c：対象（濃淡付き）
    properties: { id: 'c' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [140, 37],
          [141, 37],
          [141, 38],
          [140, 37],
        ],
      ],
    },
  },
  // id を持たない feature は対象に含めない（露出防止）
  { properties: null, geometry: { type: 'Point', coordinates: [0, 0] } },
]

test('boundsFromTargetFeatures: 述語で対象のみ絞り、外接矩形に 4% 余白を足す', () => {
  const isTarget = (id: string) => id === 'a' || id === 'c'
  // 対象 a+c の外接矩形＝west138 east141 south35 north38（span=3,3）→ 4% 余白 0.12
  assert.deepEqual(boundsFromTargetFeatures(TARGET_FEATURES, isTarget), {
    west: 137.88,
    east: 141.12,
    south: 34.88,
    north: 38.12,
  })
})

test('boundsFromTargetFeatures: 対象 0 件は null（現在表示中フォールバックの合図）', () => {
  // どの id も対象でない（抑止校区・反響ゼロだけの市を想定）
  assert.equal(boundsFromTargetFeatures(TARGET_FEATURES, () => false), null)
  // 空配列も null
  assert.equal(boundsFromTargetFeatures([], () => true), null)
})

test('boundsFromTargetFeatures: padFrac は注入可能（0 なら余白なし）', () => {
  const isTarget = (id: string) => id === 'a'
  assert.deepEqual(boundsFromTargetFeatures(TARGET_FEATURES, isTarget, 0), {
    west: 138,
    east: 139,
    south: 35,
    north: 36,
  })
})

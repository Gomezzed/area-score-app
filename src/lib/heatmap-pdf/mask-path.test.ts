// 校区ヒートマップ PDF「市外を薄くする」マスク幾何（純ロジック）のユニットテスト。依存ゼロ。
//   ⚠ 相対 import は .ts 拡張子を明示。@/ は使わない。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  collectPolygonRings,
  buildMaskPath,
  maskPointCount,
  type FeatureLike,
} from './mask-path.ts'

// 架空の feature 群。tier の有無に相当する差（props 無し等）を混ぜても収集は絞らない。
const FEATURES: FeatureLike[] = [
  // Polygon（外環 4 点＋穴 4 点＝2 リング）
  {
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
        [
          [0.2, 0.2],
          [0.4, 0.2],
          [0.4, 0.4],
          [0.2, 0.2],
        ],
      ],
    },
  },
  // MultiPolygon（2 ポリゴン・各外環 3 点＝2 リング）
  {
    geometry: {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [2, 2],
            [3, 2],
            [2, 2],
          ],
        ],
        [
          [
            [5, 5],
            [6, 5],
            [5, 5],
          ],
        ],
      ],
    },
  },
  // geometry=null（無視）
  { geometry: null },
  // Point（ポリゴンでない・無視）
  { geometry: { type: 'Point', coordinates: [9, 9] } },
]

test('collectPolygonRings: 全 feature の Polygon/MultiPolygon リングを絞らず収集', () => {
  const rings = collectPolygonRings(FEATURES)
  // Polygon: 2 リング + MultiPolygon: 2 リング = 4 リング（null / Point は無視）
  assert.equal(rings.length, 4)
  // 総点数: 4 + 4 + 3 + 3 = 14
  const total = rings.reduce((s, r) => s + r.length, 0)
  assert.equal(total, 14)
})

test('collectPolygonRings: 空配列は空リング', () => {
  assert.deepEqual(collectPolygonRings([]), [])
})

test('buildMaskPath: 先頭がフレーム矩形・以降が校区リング（リング数と点数）', () => {
  const frame = [
    [0, 0],
    [100, 0],
    [100, 60],
    [0, 60],
  ]
  const featureRingsPx = [
    [
      [10, 10],
      [20, 10],
      [20, 20],
      [10, 10],
    ],
    [
      [30, 30],
      [40, 30],
      [30, 30],
    ],
  ]
  const path = buildMaskPath(frame, featureRingsPx)
  // リング数 = 1（フレーム）+ 2（校区）
  assert.equal(path.rings.length, 3)
  // 先頭はフレーム矩形そのもの
  assert.deepEqual(path.rings[0], frame)
  // 総点数 = 4（フレーム）+ 4 + 3 = 11
  assert.equal(maskPointCount(path), 11)
})

test('buildMaskPath: 校区リングが 0 本ならフレームのみ（点数 4）', () => {
  const frame = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ]
  const path = buildMaskPath(frame, [])
  assert.equal(path.rings.length, 1)
  assert.equal(maskPointCount(path), 4)
})

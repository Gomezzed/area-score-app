// 校区ヒートマップ PDF タイル幾何（純ロジック）のユニットテスト。依存ゼロ。
//   ⚠ 相対 import は .ts 拡張子を明示。@/ は使わない。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  project,
  worldSize,
  spanPx,
  chooseZoom,
  tileRangeForFrame,
  tileCount,
  chooseZoomWithTileCap,
  subdomainFor,
  buildTileUrl,
  TILE_SIZE,
} from './tiles.ts'

test('project: 既知3点を ±0.5px で満たす（z=0・tile 256）', () => {
  const origin = project(0, 0, 0)
  assert.ok(Math.abs(origin.x - 128) < 0.5)
  assert.ok(Math.abs(origin.y - 128) < 0.5)
  assert.ok(Math.abs(project(180, 0, 0).x - 256) < 0.5)
  assert.ok(Math.abs(project(-180, 0, 0).x - 0) < 0.5)
  // メルカトル上端（lat≈85.05112878）は y≈0
  assert.ok(Math.abs(project(0, 85.05112878, 0).y - 0) < 0.5)
})

test('project: z+1 でワールドは2倍（相似・歪ませない）', () => {
  const a = project(139.6917, 35.6895, 5)
  const b = project(139.6917, 35.6895, 6)
  assert.ok(Math.abs(b.x - a.x * 2) < 1e-6)
  assert.ok(Math.abs(b.y - a.y * 2) < 1e-6)
  assert.equal(worldSize(1), 512)
  assert.equal(worldSize(0, TILE_SIZE), 256)
})

test('chooseZoom: 収まる最大 z を返し、z+1 では収まらない', () => {
  const bounds = { west: -1, east: 1, south: -1, north: 1 }
  const frameW = 500
  const frameH = 500
  const z = chooseZoom(bounds, frameW, frameH, { maxZoom: 18 })
  const s = spanPx(bounds, z)
  assert.ok(s.width <= frameW && s.height <= frameH, 'z は収まる')
  const s1 = spanPx(bounds, z + 1)
  assert.ok(s1.width > frameW || s1.height > frameH, 'z+1 では収まらない')
})

test('chooseZoom: maxZoom は 18 で頭打ち', () => {
  // 極小 bounds はどのズームでも収まる → cap の 18 を返す
  const bounds = { west: -1e-4, east: 1e-4, south: -1e-4, north: 1e-4 }
  assert.equal(chooseZoom(bounds, 2000, 2000, { maxZoom: 19 }), 18)
})

test('tileRangeForFrame + tileCount: 中心固定でフレームを覆う（既知値）', () => {
  // z=2（worldSize=1024）・中心(0,0)=(512,512)・フレーム 512×512 → 左上(256,256)
  const range = tileRangeForFrame({ lng: 0, lat: 0 }, 2, 512, 512)
  assert.equal(range.xMin, 1)
  assert.equal(range.xMax, 2)
  assert.equal(range.yMin, 1)
  assert.equal(range.yMax, 2)
  assert.equal(tileCount(range), 4)
  assert.ok(Math.abs(range.originX - 256) < 1e-9)
  assert.ok(Math.abs(range.originY - 256) < 1e-9)
})

test('chooseZoomWithTileCap: 上限内はそのまま／極小上限では z を下げる', () => {
  const center = { lng: 0, lat: 0 }
  const bounds = { west: -1, east: 1, south: -1, north: 1 }
  const base = chooseZoom(bounds, 512, 512, { maxZoom: 18 })
  // 上限が十分大きければ chooseZoom と同値
  assert.equal(chooseZoomWithTileCap(center, bounds, 512, 512, { maxZoom: 18 }, 150), base)
  // 上限を極小(1)にすると満たせず minZoom(0) まで下がる
  const capped = chooseZoomWithTileCap(center, bounds, 512, 512, { maxZoom: 18, minZoom: 0 }, 1)
  assert.ok(capped < base)
  assert.equal(capped, 0)
})

test('subdomainFor: (x+y)%len で a/b/c（負値も正へ丸める）', () => {
  const sub = ['a', 'b', 'c']
  assert.equal(subdomainFor(3608, 1623, sub), sub[(3608 + 1623) % 3])
  assert.equal(subdomainFor(0, 0, sub), 'a')
  assert.equal(subdomainFor(-1, 0, sub), 'c') // ((-1)%3+3)%3 = 2
})

test('buildTileUrl: {r} は空文字・{s}{z}{x}{y} を置換', () => {
  const tpl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}{r}.png'
  const url = buildTileUrl(tpl, { s: 'a', x: 3608, y: 1623, z: 12 })
  assert.equal(url, 'https://a.tile.openstreetmap.org/12/3608/1623.png')
  assert.ok(!url.includes('{'))
})

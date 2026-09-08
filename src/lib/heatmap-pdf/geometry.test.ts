// 校区ヒートマップ PDF 幾何（純ロジック）のユニットテスト。依存ゼロ。
//   ⚠ 相対 import は .ts 拡張子を明示（node --test の解決要件）。@/ は使わない。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mmToPt,
  framePx,
  frameRectPt,
  headerRectPt,
  footerRectPt,
  A4_LANDSCAPE_PT,
  PDF_PX_PER_PT,
} from './geometry.ts'

test('mmToPt: 25.4mm = 72pt（1インチ）', () => {
  assert.equal(mmToPt(25.4), 72)
  assert.ok(Math.abs(mmToPt(10) - 28.3464566929) < 1e-6)
})

test('framePx: フレームは 2356 × 1276 px（277×150mm × 3px/pt）', () => {
  const px = framePx()
  assert.equal(px.width, 2356)
  assert.equal(px.height, 1276)
  // 倍率どおり（round 前の値と整合）
  assert.equal(px.width, Math.round(frameRectPt().width * PDF_PX_PER_PT))
})

test('frameRectPt: 上端 y=24mm・幅 277mm・高さ 150mm（pt）', () => {
  const r = frameRectPt()
  assert.ok(Math.abs(r.y - mmToPt(24)) < 1e-9)
  assert.ok(Math.abs(r.width - mmToPt(277)) < 1e-9)
  assert.ok(Math.abs(r.height - mmToPt(150)) < 1e-9)
})

test('headerRectPt: 高さ 12mm・上余白 10mm の内側', () => {
  const h = headerRectPt()
  assert.ok(Math.abs(h.y - mmToPt(10)) < 1e-9)
  assert.ok(Math.abs(h.height - mmToPt(12)) < 1e-9)
})

test('footerRectPt: フレーム下端から下余白まで（正の高さ・用紙内）', () => {
  const frame = frameRectPt()
  const footer = footerRectPt()
  assert.ok(footer.height > 0)
  assert.ok(Math.abs(footer.y - (frame.y + frame.height)) < 1e-9)
  // 下端が用紙内（下余白 10mm の位置）
  assert.ok(Math.abs(footer.y + footer.height - (A4_LANDSCAPE_PT.height - mmToPt(10))) < 1e-9)
})

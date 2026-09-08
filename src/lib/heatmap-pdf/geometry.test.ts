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
  PANEL_GAP_MM,
  panelWidthMm,
  panelRectsPt,
  panelFramePx,
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

// ── 2パネル幾何（PR-C・追加のみ）──

test('panelWidthMm: 等分幅 = (277 - 4) / 2 = 136.5mm', () => {
  assert.equal(PANEL_GAP_MM, 4)
  assert.equal(panelWidthMm(), 136.5)
})

test('panelRectsPt ①: 左右2枠の幅 + 間隔 = 全フレーム幅（pt）', () => {
  const frame = frameRectPt()
  const { left, right } = panelRectsPt()
  const gap = mmToPt(PANEL_GAP_MM)
  // 幅の等分
  assert.ok(Math.abs(left.width - right.width) < 1e-9)
  // 2枠 + 間隔 = 全フレーム幅
  assert.ok(Math.abs(left.width + right.width + gap - frame.width) < 1e-9)
  // 左は frame 左端、右は 幅 + 間隔だけ右、右端が frame 右端に一致
  assert.ok(Math.abs(left.x - frame.x) < 1e-9)
  assert.ok(Math.abs(right.x - (frame.x + left.width + gap)) < 1e-9)
  assert.ok(Math.abs(right.x + right.width - (frame.x + frame.width)) < 1e-9)
})

test('panelRectsPt ②: 高さ・y は全フレームと同一（両パネル）', () => {
  const frame = frameRectPt()
  const { left, right } = panelRectsPt()
  assert.ok(Math.abs(left.height - frame.height) < 1e-9)
  assert.ok(Math.abs(right.height - frame.height) < 1e-9)
  assert.ok(Math.abs(left.y - frame.y) < 1e-9)
  assert.ok(Math.abs(right.y - frame.y) < 1e-9)
})

test('panelFramePx ③: パネル px は左枠 px と一致し、高さは全フレーム px と同一', () => {
  const { left } = panelRectsPt()
  const px = panelFramePx()
  assert.equal(px.width, Math.round(left.width * PDF_PX_PER_PT))
  assert.equal(px.height, Math.round(left.height * PDF_PX_PER_PT))
  // 高さは全フレーム（1276px）と同一。幅は全フレーム幅より狭い（縦長）。
  assert.equal(px.height, framePx().height)
  assert.ok(px.width < framePx().width)
})

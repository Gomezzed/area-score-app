// 校区ヒートマップ PDF 表示モデル（純ロジック）のユニットテスト。依存ゼロ。
//   ⚠ 相対 import は .ts 拡張子を明示。@/ は使わない。
//   凡例の 5 行が単一の真実源（school-district-tiers / school-district-map-style の export）と
//   同一であることも検証する。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildLegendRows,
  uniqueAttributions,
  buildFileName,
  formatGeneratedAt,
  buildTitle,
  buildMetaTitle,
} from './model.ts'
import { TIER_LABEL, NO_DATA_LEGEND } from '../school-district-tiers.ts'
import { TIER_FILL, NO_DATA_FILL } from '../school-district-map-style.ts'

test('buildLegendRows: tier4→1 ＋ データ無し の 5 行', () => {
  const rows = buildLegendRows(TIER_LABEL, TIER_FILL, NO_DATA_FILL, NO_DATA_LEGEND)
  assert.equal(rows.length, 5)
  assert.deepEqual(
    rows.map((r) => r.dashed),
    [false, false, false, false, true],
  )
})

test('凡例5行のラベルと色は school-district-tiers / map-style の export と同一', () => {
  const rows = buildLegendRows(TIER_LABEL, TIER_FILL, NO_DATA_FILL, NO_DATA_LEGEND)
  const tiers = [4, 3, 2, 1]
  tiers.forEach((t, i) => {
    assert.equal(rows[i].label, TIER_LABEL[t], `tier=${t} のラベルは TIER_LABEL`)
    assert.equal(rows[i].color, TIER_FILL[t], `tier=${t} の色は TIER_FILL`)
    assert.equal(rows[i].opacity, 0.6)
  })
  assert.equal(rows[4].label, NO_DATA_LEGEND)
  assert.equal(rows[4].color, NO_DATA_FILL)
  assert.equal(rows[4].opacity, 0.25)
})

test('LegendRow は件数キーを持てない（label/color/opacity/dashed のみ）', () => {
  const rows = buildLegendRows(TIER_LABEL, TIER_FILL, NO_DATA_FILL, NO_DATA_LEGEND)
  for (const r of rows) {
    assert.deepEqual(Object.keys(r).sort(), ['color', 'dashed', 'label', 'opacity'])
    assert.ok(!('count' in r) && !('件数' in r))
  }
})

test('uniqueAttributions: 重複除去・null/空を除く・出現順', () => {
  const out = uniqueAttributions([
    { attribution_text: '出典: 岩国市' },
    { attribution_text: null },
    { attribution_text: '出典: 岩国市' },
    { attribution_text: '出典: 国土数値情報' },
    { attribution_text: '' },
  ])
  assert.deepEqual(out, ['出典: 岩国市', '出典: 国土数値情報'])
})

test('buildFileName: ASCII のみ・UUID を含まない・規定書式', () => {
  const d = new Date(Date.UTC(2026, 8, 8, 5, 30)) // JST 2026-09-08 14:30
  const name = buildFileName('35208', 'elementary', d)
  assert.equal(name, 'areascore_heatmap_35208_elementary_20260908-1430.pdf')
  assert.ok(/^[\x20-\x7E]+$/.test(name), 'ASCII 印字可能文字のみ')
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(name), 'UUID を含まない')
  assert.equal(buildFileName('35208', 'junior_high', d).includes('junior_high'), true)
})

test('formatGeneratedAt: JST・分まで（決定的）', () => {
  const d = new Date(Date.UTC(2026, 8, 8, 5, 30))
  assert.equal(formatGeneratedAt(d), '2026-09-08 14:30 JST')
  // 日付境界：JST は UTC+9
  const d2 = new Date(Date.UTC(2026, 8, 8, 15, 0)) // JST 翌日 00:00
  assert.equal(formatGeneratedAt(d2), '2026-09-09 00:00 JST')
})

test('buildTitle / buildMetaTitle', () => {
  assert.equal(buildTitle('岩国市', '小学校区'), '校区別の反響の濃さ ― 岩国市（小学校区）')
  assert.equal(buildMetaTitle('岩国市'), '校区別の反響の濃さ 岩国市')
})

// 校区ヒートマップ地図の塗り分けスタイル（純ロジック）のユニットテスト。
//   実行: npm test （= node --test 'src/**/*.test.ts'）。依存ゼロ。
//   ⚠ 相対 import は .ts 拡張子を明示（node --test の解決要件）。
//   ⚠ @/ エイリアス・next/server は解決できないため、純ロジックのみを対象にする。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tierToPathStyle, TIER_FILL } from './school-district-map-style.ts'

test('tier 1〜4 は実線（dashArray なし）で TIER_FILL の色を塗る', () => {
  for (const tier of [1, 2, 3, 4]) {
    const s = tierToPathStyle(tier)
    assert.equal(s.dashArray, undefined, `tier=${tier} は実線であること`)
    assert.equal(s.fillColor, TIER_FILL[tier], `tier=${tier} の塗り色は TIER_FILL[${tier}]`)
    assert.ok(s.fillOpacity > 0, `tier=${tier} は視認できる不透明度`)
  }
})

test('tier=null は破線（dashArray あり）で塗る', () => {
  const s = tierToPathStyle(null)
  assert.ok(s.dashArray !== undefined && s.dashArray.length > 0, 'null は破線であること')
})

test('tier=undefined も破線で塗る', () => {
  const s = tierToPathStyle(undefined)
  assert.ok(s.dashArray !== undefined && s.dashArray.length > 0, 'undefined は破線であること')
})

test('tier=1 と null のスタイルは等しくない（色だけでなく破線で必ず差がつく）', () => {
  const one = tierToPathStyle(1)
  const none = tierToPathStyle(null)
  assert.notDeepEqual(one, none, 'tier=1 と null は同一スタイルにしない')
  // 破線の有無で必ず差がつくこと（必須要件）。
  assert.notEqual(one.dashArray, none.dashArray, 'tier=1 は実線・null は破線で区別する')
})

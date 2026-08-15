// safeNextPath のユニットテスト（依存ゼロ・Node 標準テストランナー）。
//   実行: npm test  （= node --test src/lib/safe-next-path.test.ts）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { safeNextPath } from './safe-next-path.ts'

test('同一オリジン内の絶対パスは許可', () => {
  assert.equal(safeNextPath('/dashboard'), '/dashboard')
  assert.equal(safeNextPath('/auth/update-password'), '/auth/update-password')
  assert.equal(safeNextPath('/dashboard?tab=1#x'), '/dashboard?tab=1#x')
})

test('プロトコル相対 // は拒否（既定へ）', () => {
  assert.equal(safeNextPath('//evil.com/path'), '/dashboard')
  assert.equal(safeNextPath('//evil.com'), '/dashboard')
})

test('絶対URL(スキーム付き)は拒否', () => {
  assert.equal(safeNextPath('https://evil.com'), '/dashboard')
  assert.equal(safeNextPath('http://evil.com/x'), '/dashboard')
})

test('バックスラッシュ始まり /\\ は拒否', () => {
  assert.equal(safeNextPath('/\\evil.com'), '/dashboard')
})

test('ドット始まり .evil.com/x は拒否（ホスト名が伸びる実攻撃ベクタの回帰テスト）', () => {
  // `${origin}${next}` = `https://areascore.jp.evil.com/x` になる経路。
  assert.equal(safeNextPath('.evil.com/x'), '/dashboard')
})

test('相対パス（/始まりでない）は拒否', () => {
  assert.equal(safeNextPath('dashboard'), '/dashboard')
  assert.equal(safeNextPath('evil.com'), '/dashboard')
})

test('空文字・null・undefined は既定へ', () => {
  assert.equal(safeNextPath(''), '/dashboard')
  assert.equal(safeNextPath(null), '/dashboard')
  assert.equal(safeNextPath(undefined), '/dashboard')
})

test('エンコード済み %2F%2Fevil.com は拒否', () => {
  // 呼び出し元(URLSearchParams.get)はデコード済み値を渡す前提。
  // デコードすると '//evil.com' となり ③ で拒否される。
  assert.equal(safeNextPath(decodeURIComponent('%2F%2Fevil.com')), '/dashboard')
  // 万一エンコードされたまま渡っても '/' 始まりでないため拒否される。
  assert.equal(safeNextPath('%2F%2Fevil.com'), '/dashboard')
})

test('fallback を明示指定できる', () => {
  assert.equal(safeNextPath(null, '/auth/update-password'), '/auth/update-password')
  assert.equal(safeNextPath('//evil.com', '/login'), '/login')
})

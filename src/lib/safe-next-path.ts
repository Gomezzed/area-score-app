/**
 * OAuth / recovery コールバック（/auth/callback）の `next` クエリを検証する。
 *
 * コールバックは `${origin}${next}` の形で遷移先を組み立てるため、`next` に
 * 外部URL・プロトコル相対URL・バックスラッシュ始まりを許すと、ホスト名が
 * 伸びて別ホストへ誘導される（オープンリダイレクト）。例:
 *   next = '.evil.com/x'  → `https://areascore.jp.evil.com/x`（別ホスト）
 *   next = '//evil.com'   → プロトコル相対で外部ホスト
 *   next = '/\\evil.com'  → ブラウザによっては `//` と解釈され外部ホスト
 *
 * そのため「同一オリジン内の絶対パス」だけを採用する。
 *
 * 前提: 呼び出し元は URLSearchParams.get() 等の**デコード済み**文字列を渡すこと。
 *       '%2F%2Fevil.com' はデコード後 '//evil.com' となり、②③で拒否される。
 *
 * @param next 検証対象（デコード済み文字列 / null / undefined）
 * @param fallback 不正時の既定遷移先（既定 '/dashboard'）
 * @returns 採用する遷移先パス。不正なら fallback
 */
export function safeNextPath(
  next: string | null | undefined,
  fallback = '/dashboard'
): string {
  // ① 文字列であること
  if (typeof next !== 'string' || next.length === 0) return fallback
  // ② '/' で始まること（絶対パスのみ）
  if (next[0] !== '/') return fallback
  // ③ '//' で始まらないこと（プロトコル相対URLによる外部遷移を防ぐ）
  if (next[1] === '/') return fallback
  // ④ '/\' で始まらないこと（バックスラッシュによるブラウザ差異を防ぐ）
  if (next[1] === '\\') return fallback
  return next
}

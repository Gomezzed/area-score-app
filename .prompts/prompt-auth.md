ultrathink

# タスク：Supabase Auth を Route Handler 方式（C案）に完全移行する

## 重要な前提
- このプロジェクトは Next.js 16 App Router + Supabase + TypeScript + Tailwind CSS
- 現行 URL: https://area-score-app.vercel.app
- 既存実装を壊さず、段階的に動作確認しながら進めること
- 不明点は推測せず、まず該当ファイルを読み込んで現状を把握してから着手すること

## 既に完了している実装（重複作業しないこと）
- src/app/auth/callback/route.ts は @supabase/ssr の createServerClient で実装済み（コミット b2b9fe0）
  → このファイルを再度書き換える必要はない
- 人口推移グラフ実装済み（コミット 88b740a）
- Supabase Stripe billing 実装済み

## 解決すべき問題
現在 src/app/login/page.tsx でクライアントサイドの supabase.auth.signInWithPassword() を呼び出していると思われる。これによりログイン後にサーバーコンポーネント側でセッションが認識されないバグが発生する可能性がある。Route Handler 経由のサーバーサイド認証に完全移行することで根治する。

まず src/app/login/page.tsx を読んで、現状がクライアントサイド signInWithPassword 方式なのかを確認すること。既にサーバーサイドRoute Handler方式になっていれば、Step 5 以降のみ実施すればよい。

## 既存ファイルの調査（最初に必ず実行）
1. src/app/login/page.tsx — 現行ログインページ（クライアント or サーバー？）
2. src/middleware.ts（存在する場合）
3. src/lib/supabase/ 配下のクライアント定義
4. src/app/auth/callback/route.ts（既に @supabase/ssr 化済み・編集不要）
5. proxy.ts（プロジェクトルートまたは src 配下）
6. src/hooks/usePlanLimit.ts または近いパス
7. package.json で @supabase/ssr のバージョン確認

## 実装ステップ

### Step 1：依存関係の確認
@supabase/ssr 未インストールなら `npm install @supabase/ssr` を実行。

### Step 2：Supabase クライアント整備
- src/lib/supabase/server.ts を createServerClient で作成。Next.js 16 の cookies() は async なので await すること。
- src/lib/supabase/client.ts を createBrowserClient で作成。

### Step 3：ログイン Route Handler 作成
src/app/api/auth/login/route.ts を新規作成：
- POST で email/password を受け取る
- サーバーサイドで signInWithPassword 実行
- 成功時200 { ok: true }、失敗時400 { ok: false, error }

### Step 4：ログアウト Route Handler 作成
src/app/api/auth/logout/route.ts を新規作成。POST で signOut 実行。

### Step 5：ログインページ改修
src/app/login/page.tsx を更新。既存デザイン（bg-slate-700系、青ボタン）は完全維持。handleSubmit を fetch('/api/auth/login', POST) に変更。成功時 router.refresh() → router.push('/dashboard')。

### Step 6：ミドルウェア整備
src/middleware.ts を @supabase/ssr 公式パターンの updateSession で作成。matcher で静的ファイル除外。

### Step 7：Google OAuth ボタン追加
ログインページに「Googleでログイン」ボタンを追加。onClick で supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: ... } })。コールバック処理は既存の auth/callback/route.ts が処理する（編集不要）。

### Step 8：動作確認
- メール/パスワードログイン → /dashboard 遷移
- リロード後セッション維持
- ログアウトで完全クリア
- usePlanLimit hook 正常動作
- Google OAuth 動作
- npm run build / npm run lint がエラーなし

## 絶対に壊してはいけない
- src/app/login/page.tsx のデザイン
- src/app/auth/callback/route.ts（既に正しく実装済み）
- proxy.ts
- usePlanLimit
- subscriptions テーブル連携
- 既存ダッシュボード（地図/グラフ/ランキング/CSV/PDF）

## 完了報告
1. 変更ファイル一覧と概要
2. チェックリスト結果
3. npm run build の結果
4. 残課題

実装開始してください。

import { createBrowserClient } from '@supabase/ssr'

// ── 環境変数 ──
//   NEXT_PUBLIC_SUPABASE_URL       … Supabase プロジェクト URL
//   NEXT_PUBLIC_SUPABASE_ANON_KEY  … 公開（anon）キー
//
// ── Google ログインを有効にする手順 ──
//   1. Supabase Dashboard > Authentication > Providers > Google を有効化
//      Google Cloud Console で発行した Client ID / Secret を登録する
//   2. Supabase Dashboard > Authentication > URL Configuration の
//      Redirect URLs に <本番URL>/auth/callback を追加する
//      （ローカル開発は http://localhost:3000/auth/callback）
//
// クライアントコンポーネントは下記の createBrowserClient を使用する。
// サーバーコンポーネント / Route Handler は src/lib/supabase-server.ts の
// createSupabaseServerClient（createServerClient ベース）を使用する。
//
// createBrowserClient はセッションを localStorage ではなく cookie に保存するため
// proxy.ts（サーバーサイド）がセッションを正しく読める
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

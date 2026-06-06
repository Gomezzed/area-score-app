import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// service_role キーを用いた管理クライアント（RLS をバイパス）。
// Stripe Webhook など、ユーザーセッションを持たないサーバー処理から
// subscriptions テーブルを更新するために使用する。
//
// 必要な環境変数:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY  … Supabase Dashboard > Settings > API から取得
//
// 未設定なら null を返す（Webhook 側でグレースフルに処理）。
let cached: SupabaseClient | null = null

export function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  if (!cached) {
    cached = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return cached
}

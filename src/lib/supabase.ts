import { createBrowserClient } from '@supabase/ssr'

// createBrowserClient はセッションをlocalStorageではなくcookieに保存するため
// proxy.ts（サーバーサイド）がセッションを正しく読める
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

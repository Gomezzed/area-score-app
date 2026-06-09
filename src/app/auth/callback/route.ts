import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Google OAuth (および他のOAuthプロバイダ) からのコールバックを処理する。
 *
 * フロー:
 *   1. Google認証完了後、Supabaseがこのエンドポイントへ `?code=xxx` 付きでリダイレクト
 *   2. exchangeCodeForSession でアクセストークンを取得しCookieへセット
 *   3. /dashboard へ遷移（または `next` クエリで指定されたURL）
 *
 * Supabase Dashboard > Authentication > URL Configuration の
 * Redirect URLs に <origin>/auth/callback を登録しておくこと。
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'
  const errorParam = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  if (errorParam) {
    console.error('[Auth Callback] OAuthエラー:', errorParam, errorDescription)
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(errorDescription ?? errorParam)}`
    )
  }

  if (!code) {
    console.error('[Auth Callback] code パラメータが存在しません')
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[Auth Callback] セッション交換エラー:', error)
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`
    )
  }

  return NextResponse.redirect(`${origin}${next}`)
}

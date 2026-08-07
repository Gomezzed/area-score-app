import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { buildGoogleAuthorizeUrl } from '@/lib/server/google-oauth'

export const runtime = 'nodejs'

// GET /api/integrations/google/authorize
//   CSRF 用 state を生成して httpOnly / SameSite=Lax / 10分 Cookie に保存し、
//   Google 認可 URL へ 302 する。セッション必須。
export async function GET() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const state = randomBytes(32).toString('hex')

  let authorizeUrl: string
  try {
    authorizeUrl = buildGoogleAuthorizeUrl(state)
  } catch {
    // OAuth 環境変数未設定。
    return NextResponse.json({ error: 'oauth_not_configured' }, { status: 500 })
  }

  const res = NextResponse.redirect(authorizeUrl)
  res.cookies.set('google_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600, // 10分
  })
  return res
}

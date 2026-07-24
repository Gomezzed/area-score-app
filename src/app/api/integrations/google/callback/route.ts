import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  exchangeCodeForTokens,
  GOOGLE_DRIVE_FILE_SCOPE,
} from '@/lib/server/google-oauth'
import { encryptToken } from '@/lib/server/token-crypto'

export const runtime = 'nodejs'

// GET /api/integrations/google/callback
//   state 検証（不一致 400）→ code をトークン交換 → refresh_token を暗号化し
//   ユーザースコープクライアント経由で user_integrations に upsert →
//   /dashboard?sheets=connected へ 302。refresh_token 不在時は sheets=error。
export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = request.nextUrl
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const cookieState = request.cookies.get('google_oauth_state')?.value

  // ── state 検証（不一致 400） ──
  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.json({ error: 'invalid_state' }, { status: 400 })
  }

  const dashboard = new URL('/dashboard', url.origin)
  const redirectWith = (status: 'connected' | 'error') => {
    dashboard.searchParams.set('sheets', status)
    const res = NextResponse.redirect(dashboard)
    res.cookies.delete('google_oauth_state')
    return res
  }

  if (!code) {
    return redirectWith('error')
  }

  try {
    const tokens = await exchangeCodeForTokens(code)
    // refresh_token 不在（再同意されなかった等）はエラー扱い。
    if (!tokens.refresh_token) {
      return redirectWith('error')
    }

    const refreshTokenEnc = encryptToken(tokens.refresh_token)
    const { error } = await supabase.from('user_integrations').upsert(
      {
        user_id: user.id,
        provider: 'google',
        refresh_token_enc: refreshTokenEnc,
        scope: tokens.scope ?? GOOGLE_DRIVE_FILE_SCOPE,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' },
    )
    if (error) {
      return redirectWith('error')
    }
    return redirectWith('connected')
  } catch {
    return redirectWith('error')
  }
}

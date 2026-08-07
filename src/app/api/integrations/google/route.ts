import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { decryptToken } from '@/lib/server/token-crypto'
import { revokeToken } from '@/lib/server/google-oauth'

export const runtime = 'nodejs'

// DELETE /api/integrations/google
//   連携解除。user_integrations の行を削除し、Google 側トークンを
//   ベストエフォートで revoke する。セッション必須。
export async function DELETE() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // revoke 用に暗号化トークンを取得（削除前）。
  const { data: existing } = await supabase
    .from('user_integrations')
    .select('refresh_token_enc')
    .eq('user_id', user.id)
    .eq('provider', 'google')
    .maybeSingle()

  const { error } = await supabase
    .from('user_integrations')
    .delete()
    .eq('user_id', user.id)
    .eq('provider', 'google')

  if (error) {
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
  }

  // ベストエフォート revoke（失敗しても行削除は完了しているので握りつぶす）。
  if (existing?.refresh_token_enc) {
    try {
      await revokeToken(decryptToken(existing.refresh_token_enc))
    } catch {
      // ignore
    }
  }

  return NextResponse.json({ ok: true })
}

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'

// GET /api/integrations/google/status
//   ログイン中ユーザーが Google（Sheets 出力）連携済みかを返す。
//   RLS により自分の行のみ参照可能（多層防御）。
export async function GET() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { data } = await supabase
    .from('user_integrations')
    .select('user_id')
    .eq('user_id', user.id)
    .eq('provider', 'google')
    .maybeSingle()

  return NextResponse.json({ connected: !!data })
}

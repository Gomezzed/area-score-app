import { NextResponse, type NextRequest } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'

// POST /api/stripe/portal
//   認証: Supabase Auth（未ログインは 401）
//   res : { url: string }  … Stripe カスタマーポータルへのリダイレクト先
//   既存サブスクリプションの管理（プラン変更・解約・支払い方法）に使用。
export async function POST(request: NextRequest) {
  const stripe = getStripe()
  if (!stripe) {
    return NextResponse.json(
      { error: 'Stripeが未設定です。STRIPE_SECRET_KEY を設定してください。' },
      { status: 503 },
    )
  }

  // ── 認証（Cookie セッション） ──
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })
  }

  const admin = getSupabaseAdmin()
  if (!admin) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY が未設定です' },
      { status: 503 },
    )
  }

  const { data } = await admin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle()

  const customerId = data?.stripe_customer_id
  if (!customerId) {
    return NextResponse.json(
      { error: 'Stripe顧客が見つかりません。先にプランをご契約ください。' },
      { status: 404 },
    )
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${request.nextUrl.origin}/dashboard`,
    })
    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('[stripe/portal] session 作成に失敗:', err)
    return NextResponse.json(
      { error: 'ポータルセッションの作成に失敗しました' },
      { status: 500 },
    )
  }
}

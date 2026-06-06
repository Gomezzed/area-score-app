import { NextResponse, type NextRequest } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

// POST /api/stripe/portal
//   body: { userId: string }
//   res:  { url: string }  … Stripe カスタマーポータルへのリダイレクト先
//   既存サブスクリプションの管理（プラン変更・解約）に使用。
export async function POST(request: NextRequest) {
  const stripe = getStripe()
  if (!stripe) {
    return NextResponse.json(
      { error: 'Stripeが未設定です。STRIPE_SECRET_KEY を設定してください。' },
      { status: 503 },
    )
  }

  let userId: string | undefined
  try {
    const body = await request.json()
    userId = body.userId
  } catch {
    return NextResponse.json({ error: 'リクエストボディが不正です' }, { status: 400 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'userId は必須です' }, { status: 400 })
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
    .eq('user_id', userId)
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
    return NextResponse.json(
      { error: `ポータルセッション作成に失敗しました: ${String(err)}` },
      { status: 500 },
    )
  }
}

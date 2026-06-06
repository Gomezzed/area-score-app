import { NextResponse, type NextRequest } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

// POST /api/stripe/checkout
//   body: { priceId: string, userId: string }
//   res:  { url: string }  … Stripe Checkout へのリダイレクト先
export async function POST(request: NextRequest) {
  const stripe = getStripe()
  if (!stripe) {
    return NextResponse.json(
      { error: 'Stripeが未設定です。STRIPE_SECRET_KEY を設定してください。' },
      { status: 503 },
    )
  }

  let priceId: string | undefined
  let userId: string | undefined
  try {
    const body = await request.json()
    priceId = body.priceId
    userId = body.userId
  } catch {
    return NextResponse.json({ error: 'リクエストボディが不正です' }, { status: 400 })
  }

  if (!priceId || !userId) {
    return NextResponse.json({ error: 'priceId と userId は必須です' }, { status: 400 })
  }

  const origin = request.nextUrl.origin

  // 既存の Stripe 顧客があれば再利用（subscriptions テーブルから引く）
  let customerId: string | undefined
  const admin = getSupabaseAdmin()
  if (admin) {
    const { data } = await admin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle()
    customerId = data?.stripe_customer_id ?? undefined
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: userId,
      ...(customerId ? { customer: customerId } : {}),
      subscription_data: {
        metadata: { user_id: userId },
      },
      success_url: `${origin}/dashboard?checkout=success`,
      cancel_url: `${origin}/pricing?checkout=cancel`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    return NextResponse.json(
      { error: `Checkout セッション作成に失敗しました: ${String(err)}` },
      { status: 500 },
    )
  }
}

import { NextResponse, type NextRequest } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { priceIdForPlan, type PaidPlanId } from '@/lib/plans'

// POST /api/stripe/checkout
//   認証: Supabase Auth（未ログインは 401）
//   body: { plan: 'starter' | 'standard' }   ※ Free は Checkout 不可 / Platinum は未提供
//   res : { url: string }  … Stripe Checkout へのリダイレクト先
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

  // ── リクエストボディ ──
  let plan: PaidPlanId | undefined
  try {
    const body = await request.json()
    plan = body.plan
  } catch {
    return NextResponse.json({ error: 'リクエストボディが不正です' }, { status: 400 })
  }
  // 課金対象は starter / standard のみ。Free は Checkout 不可、Platinum は β期間中未提供。
  if (plan !== 'starter' && plan !== 'standard') {
    return NextResponse.json(
      { error: "plan は 'starter' または 'standard' を指定してください" },
      { status: 400 },
    )
  }

  // ── 該当プランの Price ID（サーバー側で解決） ──
  const priceId = priceIdForPlan(plan)
  if (!priceId) {
    return NextResponse.json(
      { error: `${plan} プランの Price ID が未設定です（環境変数を確認してください）` },
      { status: 503 },
    )
  }

  const origin = request.nextUrl.origin

  // 既存の Stripe 顧客があれば再利用（subscriptions テーブルから引く）
  let customerId: string | undefined
  const admin = getSupabaseAdmin()
  if (admin) {
    const { data } = await admin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle()
    customerId = data?.stripe_customer_id ?? undefined
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      // Webhook 側で Supabase ユーザーを特定するための識別子
      client_reference_id: user.id,
      metadata: { supabase_user_id: user.id },
      subscription_data: {
        metadata: { supabase_user_id: user.id },
      },
      // 既存顧客があれば customer を、無ければメールを渡す（両者は併用不可）
      ...(customerId
        ? { customer: customerId }
        : user.email
          ? { customer_email: user.email }
          : {}),
      success_url: `${origin}/dashboard?checkout=success`,
      cancel_url: `${origin}/pricing?checkout=cancel`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('[stripe/checkout] session 作成に失敗:', err)
    return NextResponse.json(
      { error: 'Checkout セッションの作成に失敗しました' },
      { status: 500 },
    )
  }
}

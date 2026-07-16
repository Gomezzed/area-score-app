import { NextResponse, type NextRequest } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { priceIdForPlan, type PaidPlanId } from '@/lib/plans'

// POST /api/stripe/checkout
//   認証: Supabase Auth（未ログインは 401）
//   body: { plan: 'starter' | 'standard' | 'platinum' }   ※ Free は Checkout 不可
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
  // 課金対象は starter / standard / platinum。Free は Checkout 不可。
  if (plan !== 'starter' && plan !== 'standard' && plan !== 'platinum') {
    return NextResponse.json(
      { error: "plan は 'starter' / 'standard' / 'platinum' のいずれかを指定してください" },
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

  // ── 再Checkoutガード（二重課金防止・Session 作成より前） ──
  // 既に有効（active / past_due）な subscriptions 行を持つユーザーは、新規 Checkout を
  // 通さない。/pricing 直叩き・API 直叩きでも Stripe 側に 2 本目の active サブスクが
  // 作られないようにする。コンプ行（stripe_customer_id = NULL・active）も対象に含める
  // ── これを通すと Webhook がコンプ設定を上書きしてしまうため。
  //   行なし（free）・status=canceled 等は従来どおり Checkout 可。
  let customerId: string | undefined
  const admin = getSupabaseAdmin()
  if (admin) {
    // 既存の Stripe 顧客の再利用と再Checkout判定を 1 クエリで賄う。
    const { data } = await admin
      .from('subscriptions')
      .select('status, stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle()

    const ACTIVE_STATUSES = new Set(['active', 'past_due'])
    if (data && ACTIVE_STATUSES.has(data.status)) {
      return NextResponse.json(
        {
          error: 'already_subscribed',
          message:
            '既にご契約中のプランがあります。プラン変更・解約はダッシュボードの「請求情報を管理」から行えます。',
        },
        { status: 409 },
      )
    }

    customerId = data?.stripe_customer_id ?? undefined
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      // live スモーク用（100%OFFプロモーションコード検証）。検証後に外すかは PO 判断。
      allow_promotion_codes: true,
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

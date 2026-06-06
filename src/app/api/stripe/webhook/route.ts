import { NextResponse, type NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { getStripe } from '@/lib/stripe'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { planFromPriceId } from '@/lib/plans'

// Stripe Webhook は生のリクエストボディで署名検証する必要があるため
// 動的レンダリングを強制する。
export const dynamic = 'force-dynamic'

// POST /api/stripe/webhook
//   checkout.session.completed       → subscriptions を作成 / 更新
//   customer.subscription.updated    → status / plan を更新
//   customer.subscription.deleted    → plan を 'free' に戻す
export async function POST(request: NextRequest) {
  const stripe = getStripe()
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  const admin = getSupabaseAdmin()

  if (!stripe || !webhookSecret) {
    return NextResponse.json({ error: 'Stripe Webhook が未設定です' }, { status: 503 })
  }
  if (!admin) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY が未設定です' },
      { status: 503 },
    )
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: '署名がありません' }, { status: 400 })
  }

  const rawBody = await request.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err) {
    return NextResponse.json({ error: `署名検証に失敗: ${String(err)}` }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const userId = session.client_reference_id ?? session.metadata?.user_id
        const subscriptionId =
          typeof session.subscription === 'string' ? session.subscription : null
        const customerId =
          typeof session.customer === 'string' ? session.customer : null

        if (!userId || !subscriptionId) break

        // サブスクリプション詳細を取得して plan / 期限を確定
        const sub = await stripe.subscriptions.retrieve(subscriptionId)
        const priceId = sub.items.data[0]?.price.id
        const plan = planFromPriceId(priceId)

        await admin.from('subscriptions').upsert(
          {
            user_id: userId,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            plan,
            status: 'active',
            current_period_end: periodEndISO(sub),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        )
        break
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const userId = sub.metadata?.user_id
        const priceId = sub.items.data[0]?.price.id
        const plan = planFromPriceId(priceId)
        const status = mapStatus(sub.status)

        const match = userId
          ? { user_id: userId }
          : { stripe_subscription_id: sub.id }

        await admin
          .from('subscriptions')
          .update({
            plan: status === 'canceled' ? 'free' : plan,
            status,
            current_period_end: periodEndISO(sub),
            updated_at: new Date().toISOString(),
          })
          .match(match)
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const userId = sub.metadata?.user_id
        const match = userId
          ? { user_id: userId }
          : { stripe_subscription_id: sub.id }

        await admin
          .from('subscriptions')
          .update({
            plan: 'free',
            status: 'canceled',
            updated_at: new Date().toISOString(),
          })
          .match(match)
        break
      }

      default:
        // 未処理イベントは無視
        break
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Webhook 処理に失敗しました: ${String(err)}` },
      { status: 500 },
    )
  }

  return NextResponse.json({ received: true })
}

// status 文字列をアプリの enum に正規化
function mapStatus(status: Stripe.Subscription.Status): 'active' | 'canceled' | 'past_due' {
  if (status === 'active' || status === 'trialing') return 'active'
  if (status === 'past_due' || status === 'unpaid') return 'past_due'
  return 'canceled'
}

// current_period_end（Unix 秒）を ISO 文字列に変換。無い場合は null。
function periodEndISO(sub: Stripe.Subscription): string | null {
  const end = (sub as unknown as { current_period_end?: number }).current_period_end
  return typeof end === 'number' ? new Date(end * 1000).toISOString() : null
}

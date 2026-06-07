import { NextResponse, type NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { getStripe } from '@/lib/stripe'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { planFromPriceId } from '@/lib/plans'

// Stripe Webhook は生のリクエストボディで署名検証する必要があるため
// 動的レンダリングを強制する（Next.js App Router）。
export const dynamic = 'force-dynamic'

// POST /api/stripe/webhook
//   checkout.session.completed     → subscriptions に upsert
//   customer.subscription.updated  → status / plan / 期限を更新
//   customer.subscription.deleted  → status='canceled'
//   invoice.payment_failed         → status='past_due'
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

  // App Router での生 body 取得（署名検証に必須）
  const rawBody = await request.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err) {
    console.error('[stripe/webhook] 署名検証に失敗:', err)
    return NextResponse.json({ error: '署名検証に失敗しました' }, { status: 400 })
  }

  try {
    switch (event.type) {
      // ── 初回契約完了 ──
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const userId =
          session.metadata?.supabase_user_id ?? session.client_reference_id ?? null
        const subscriptionId =
          typeof session.subscription === 'string' ? session.subscription : null
        const customerId =
          typeof session.customer === 'string' ? session.customer : null

        if (!userId || !subscriptionId) {
          console.warn(
            '[stripe/webhook] checkout.session.completed: user_id / subscription を特定できず skip',
          )
          break
        }

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
            status: mapStatus(sub.status),
            current_period_end: periodEndISO(sub),
            cancel_at_period_end: sub.cancel_at_period_end ?? false,
            updated_at: nowISO(),
          },
          { onConflict: 'user_id' },
        )
        console.log(`[stripe/webhook] checkout 完了: user=${userId} plan=${plan}`)
        break
      }

      // ── プラン変更 / 状態更新 ──
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const userId = sub.metadata?.supabase_user_id
        const priceId = sub.items.data[0]?.price.id
        const plan = planFromPriceId(priceId)
        const status = mapStatus(sub.status)

        const match = userId
          ? { user_id: userId }
          : { stripe_subscription_id: sub.id }

        await admin
          .from('subscriptions')
          .update({
            // canceled 状態ならアクセス権を落とすため plan='free'
            plan: status === 'canceled' ? 'free' : plan,
            status,
            current_period_end: periodEndISO(sub),
            cancel_at_period_end: sub.cancel_at_period_end ?? false,
            updated_at: nowISO(),
          })
          .match(match)
        console.log(`[stripe/webhook] subscription.updated: sub=${sub.id} status=${status}`)
        break
      }

      // ── 解約（期間満了 or 即時） ──
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const userId = sub.metadata?.supabase_user_id
        const match = userId
          ? { user_id: userId }
          : { stripe_subscription_id: sub.id }

        await admin
          .from('subscriptions')
          .update({
            plan: 'free',
            status: 'canceled',
            cancel_at_period_end: false,
            updated_at: nowISO(),
          })
          .match(match)
        console.log(`[stripe/webhook] subscription.deleted: sub=${sub.id}`)
        break
      }

      // ── 支払い失敗 ──
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId =
          typeof invoice.customer === 'string' ? invoice.customer : null
        if (!customerId) {
          console.warn('[stripe/webhook] invoice.payment_failed: customer 不明で skip')
          break
        }

        await admin
          .from('subscriptions')
          .update({ status: 'past_due', updated_at: nowISO() })
          .eq('stripe_customer_id', customerId)
        console.log(`[stripe/webhook] payment_failed: customer=${customerId} → past_due`)
        break
      }

      default:
        // 未処理イベントは無視
        break
    }
  } catch (err) {
    console.error(`[stripe/webhook] イベント処理に失敗 (${event.type}):`, err)
    return NextResponse.json(
      { error: 'Webhook 処理に失敗しました' },
      { status: 500 },
    )
  }

  return NextResponse.json({ received: true })
}

// Stripe の status 文字列をアプリの状態に正規化
function mapStatus(
  status: Stripe.Subscription.Status,
): 'active' | 'canceled' | 'past_due' {
  if (status === 'active' || status === 'trialing') return 'active'
  if (status === 'past_due' || status === 'unpaid') return 'past_due'
  return 'canceled'
}

// current_period_end を ISO 文字列に変換。
// Stripe SDK v22 では current_period_end は Subscription 直下ではなく
// subscription item（items.data[].current_period_end）に存在する。
function periodEndISO(sub: Stripe.Subscription): string | null {
  const end = sub.items.data[0]?.current_period_end
  return typeof end === 'number' ? new Date(end * 1000).toISOString() : null
}

function nowISO(): string {
  return new Date().toISOString()
}

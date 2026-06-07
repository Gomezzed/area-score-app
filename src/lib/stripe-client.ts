import { loadStripe, type Stripe } from '@stripe/stripe-js'

// クライアントサイド用 Stripe.js ローダー。
// 実際には Checkout / Portal へのリダイレクトは API が返す session.url に
// window.location で遷移する方式のため Stripe.js 本体は必須ではないが、
// 将来 Stripe Elements 等を使う場合に備えてシングルトンを用意しておく。
//
// 必要な環境変数:
//   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY  … pk_test_ / pk_live_
let stripePromise: Promise<Stripe | null> | null = null

export function getStripeClient(): Promise<Stripe | null> {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  if (!key) return Promise.resolve(null)
  if (!stripePromise) {
    stripePromise = loadStripe(key)
  }
  return stripePromise
}

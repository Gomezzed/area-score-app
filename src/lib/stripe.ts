import Stripe from 'stripe'

// サーバーサイド専用 Stripe クライアント。
// STRIPE_SECRET_KEY が未設定なら null を返し、呼び出し側でグレースフルに
// 「Stripe 未設定」エラーを返せるようにする（アプリ自体は起動可能）。
let cached: Stripe | null = null

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  if (!cached) {
    cached = new Stripe(key)
  }
  return cached
}

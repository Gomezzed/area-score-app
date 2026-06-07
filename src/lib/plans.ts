// ============================================================
// 料金プラン定義（クライアント / サーバー共通）
//   Stripe の Price ID は NEXT_PUBLIC 環境変数から読み込む。
//   未設定（プレースホルダ）でもUIは表示でき、チェックアウト時のみ
//   設定が必要というグレースフルな構成にする。
//
//   料金は税込表示。
//     FREE     : 無料（上位3件のみ表示）
//     LIGHT    : 月額 33,000円（税込）／ 全データ閲覧・CSV出力
//     STANDARD : 月額 55,000円（税込）／ 全機能・PDFレポート
// ============================================================

export type PlanId = 'free' | 'light' | 'standard'

// 課金対象（Stripe Checkout を開始できる）有料プラン
export type PaidPlanId = 'light' | 'standard'

export interface Plan {
  id: PlanId
  name: string
  price: number // 月額（円・税込）。0 は無料
  priceLabel: string
  description: string
  features: string[]
  // Stripe Price ID（free は null）
  priceId: string | null
  recommended?: boolean
}

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'FREE',
    price: 0,
    priceLabel: '無料',
    description: 'まずは無料でお試し',
    features: [
      '上位3件のみ表示',
      '人口動態の概要表示',
      '地図表示',
    ],
    priceId: null,
  },
  {
    id: 'light',
    name: 'LIGHT',
    price: 33000,
    priceLabel: '¥33,000',
    description: '全データにアクセス',
    features: [
      '全市区町村データ閲覧',
      'CSV出力',
      '地図ヒートマップ',
      '人口増減率の詳細分析',
    ],
    priceId: process.env.NEXT_PUBLIC_STRIPE_LIGHT_PRICE_ID ?? null,
  },
  {
    id: 'standard',
    name: 'STANDARD',
    price: 55000,
    priceLabel: '¥55,000',
    description: '本格的な分析業務に',
    features: [
      'LIGHTの全機能',
      'PDFレポート出力',
      'エリア比較機能',
      '優先サポート',
    ],
    priceId: process.env.NEXT_PUBLIC_STRIPE_STANDARD_PRICE_ID ?? null,
    recommended: true,
  },
]

export const PLAN_MAP: Record<PlanId, Plan> = PLANS.reduce(
  (acc, p) => ({ ...acc, [p.id]: p }),
  {} as Record<PlanId, Plan>,
)

// 有料プラン（free 以外）は全データアクセス可
export function canAccessFull(plan: PlanId): boolean {
  return plan === 'light' || plan === 'standard'
}

// 無料プランで閲覧できる市区町村数の上限
export const FREE_PLAN_LIMIT = 3

// プランID → Stripe Price ID（サーバーサイドの Checkout で使用）。
// 該当プランの Price ID が未設定なら null。
export function priceIdForPlan(plan: PaidPlanId): string | null {
  if (plan === 'light') return process.env.NEXT_PUBLIC_STRIPE_LIGHT_PRICE_ID ?? null
  if (plan === 'standard') return process.env.NEXT_PUBLIC_STRIPE_STANDARD_PRICE_ID ?? null
  return null
}

// Stripe Price ID から plan を逆引き（Webhook で使用）
export function planFromPriceId(priceId: string | null | undefined): PlanId {
  if (!priceId) return 'free'
  if (priceId === process.env.NEXT_PUBLIC_STRIPE_LIGHT_PRICE_ID) return 'light'
  if (priceId === process.env.NEXT_PUBLIC_STRIPE_STANDARD_PRICE_ID) return 'standard'
  return 'free'
}

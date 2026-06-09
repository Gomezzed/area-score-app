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

// ============================================================
// βリリース用 料金プラン（表示専用）
//   PO 確定の Starter / Standard / Platinum 3プラン構成。
//   β特別価格を主表示・通常価格を斜線表示する Google One 形式。
//   β価格は契約継続中ずっと据え置き。
//
//   ※ これは LP / 料金ページの表示専用データ。実際の課金
//     プラミング（checkout / webhook / subscription）は上記の
//     PLANS / PlanId を引き続き使用し、新プランIDの Checkout
//     受付処理は別タスクで実装する。
// ============================================================

export type BetaPlanId = 'starter' | 'standard' | 'platinum'

export interface BetaPlan {
  id: BetaPlanId
  name: string
  description: string
  betaPriceLabel: string // β特別価格（主表示）
  regularPriceLabel: string // 通常価格（斜線・参考表示）
  features: string[]
  recommended?: boolean
}

export const BETA_PLANS: BetaPlan[] = [
  {
    id: 'starter',
    name: 'Starter',
    description: '個人事業主・小規模仲介会社向け',
    betaPriceLabel: '¥30,000',
    regularPriceLabel: '¥50,000',
    features: [
      '都道府県・市区町村レベルのエリアスコア',
      '人口動態グラフ',
      'CSV出力',
      '1ID',
      'メールサポート',
    ],
  },
  {
    id: 'standard',
    name: 'Standard',
    description: '中堅仲介会社向け',
    betaPriceLabel: '¥50,000',
    regularPriceLabel: '¥100,000',
    features: [
      'Starter の全機能',
      '地図ヒートマップ',
      'PDFレポート',
      '5ID',
      'メール優先サポート',
    ],
    recommended: true,
  },
  {
    id: 'platinum',
    name: 'Platinum',
    description: '大手仲介会社・チェーン展開向け',
    betaPriceLabel: '¥100,000',
    regularPriceLabel: '¥300,000',
    features: [
      'Standard の全機能',
      'エリア比較',
      '20ID',
      'Slack・Zoom サポート',
      'PDFロゴ対応',
    ],
  },
]

// βプラン CTA の遷移先（plan パラメータ受付処理は別タスクで実装予定）
export function betaCheckoutHref(plan: BetaPlanId): string {
  return `/api/stripe/checkout?plan=${plan}`
}

// ============================================================
// 料金プラン定義（クライアント / サーバー共通）
//   Stripe の Price ID は NEXT_PUBLIC 環境変数から読み込む。
//   未設定（プレースホルダ）でもUIは表示でき、チェックアウト時のみ
//   設定が必要というグレースフルな構成にする。
//
//   料金は税込表示。
//     FREE     : 無料（上位3エリアのみ閲覧 / 出力不可）
//     STARTER  : 月額 33,000円（税込）／ 全エリア閲覧・PDF出力（旧 LIGHT をリネーム）
//     STANDARD : 月額 55,000円（税込）／ 全機能・CSV/PDF出力・ヒートマップ
// ============================================================

export type PlanId = 'free' | 'starter' | 'standard' | 'platinum'

// 課金対象（Stripe Checkout を開始できる）有料プラン
export type PaidPlanId = 'starter' | 'standard' | 'platinum'

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
    id: 'starter',
    name: 'STARTER',
    price: 33000,
    priceLabel: '¥33,000',
    description: '全エリア閲覧・PDF出力',
    features: [
      '全市区町村データ閲覧',
      'PDFレポート出力',
      '人口増減率の詳細分析',
    ],
    priceId: process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID ?? null,
  },
  {
    id: 'standard',
    name: 'STANDARD',
    price: 55000,
    priceLabel: '¥55,000',
    description: '本格的な分析業務に',
    features: [
      'STARTERの全機能',
      'CSV出力',
      '地図ヒートマップ',
      'エリア比較機能',
    ],
    priceId: process.env.NEXT_PUBLIC_STRIPE_STANDARD_PRICE_ID ?? null,
    recommended: true,
  },
]

export const PLAN_MAP: Record<PlanId, Plan> = PLANS.reduce(
  (acc, p) => ({ ...acc, [p.id]: p }),
  {} as Record<PlanId, Plan>,
)

// 有料プラン（free 以外）は全エリアを閲覧可（= エリア可視数制限なし）
export function canAccessFull(plan: PlanId): boolean {
  return plan !== 'free'
}

// ------------------------------------------------------------
// 料金設計 v2.1 プラン別エンタイトルメント（機能フラグ）
//   Free    : 上位3エリア閲覧のみ / ヒートマップ無 / 出力不可(PDF・CSV) / 1ID
//   Starter : 全エリア / PDF出力のみ / CSV不可 / ヒートマップ無 / 1ID
//   Standard: 全エリア / CSV+PDF出力 / ヒートマップ可 / 5ID / 駅単位の権限あり
//   Platinum: Standard 全機能 + 町域取得優先/エリア比較/商圏レポート/アラート/PDFロゴ / 20ID
//   ※ 駅単位は権限(stationLevelEntitled)を持つだけで、実利用は
//      NEXT_PUBLIC_FEATURE_STATION_LEVEL との AND（usePlanLimit 側で評価）。
// ------------------------------------------------------------

// 無料プランで閲覧できるエリア数（上位N件）の上限
export const FREE_VISIBLE_AREA_LIMIT = 3

export interface PlanEntitlements {
  // 閲覧可能なエリア数の上限。null は無制限。
  visibleAreaLimit: number | null
  canExportPdf: boolean
  canExportCsv: boolean
  // Google Sheets へのワンクリック出力。CSV と同格（Standard 以上）。
  canExportSheets: boolean
  canUseHeatmap: boolean
  // 契約に含まれる利用ID（席）数
  seatLimit: number
  // 駅単位データの利用権限（実利用はマスターフラグと AND）
  stationLevelEntitled: boolean
  // 相場・公示価格データの利用権限（実利用はマスターフラグと AND・T8）
  marketMetricsEntitled: boolean
  // ── Platinum 専用機能（料金v2.1）。free/starter/standard は false ──
  townAcquisitionPriority: boolean // 町域取得優先
  areaCompare: boolean // エリア比較
  tradeAreaReport: boolean // 商圏レポート
  alerts: boolean // アラート
  pdfLogo: boolean // PDF ロゴ差し込み
}

export const PLAN_ENTITLEMENTS: Record<PlanId, PlanEntitlements> = {
  free: {
    visibleAreaLimit: FREE_VISIBLE_AREA_LIMIT,
    canExportPdf: false,
    canExportCsv: false,
    canExportSheets: false,
    canUseHeatmap: false,
    seatLimit: 1,
    stationLevelEntitled: false,
    marketMetricsEntitled: false,
    townAcquisitionPriority: false,
    areaCompare: false,
    tradeAreaReport: false,
    alerts: false,
    pdfLogo: false,
  },
  starter: {
    visibleAreaLimit: null,
    canExportPdf: true,
    canExportCsv: false,
    canExportSheets: false,
    canUseHeatmap: false,
    seatLimit: 1,
    stationLevelEntitled: false,
    marketMetricsEntitled: false,
    townAcquisitionPriority: false,
    areaCompare: false,
    tradeAreaReport: false,
    alerts: false,
    pdfLogo: false,
  },
  standard: {
    visibleAreaLimit: null,
    canExportPdf: true,
    canExportCsv: true,
    canExportSheets: true,
    canUseHeatmap: true,
    seatLimit: 5,
    stationLevelEntitled: true,
    marketMetricsEntitled: true,
    townAcquisitionPriority: false,
    areaCompare: false,
    tradeAreaReport: false,
    alerts: false,
    pdfLogo: false,
  },
  // Platinum: Standard の全機能を最上位として継承しつつ、Platinum 専用機能を解放。
  platinum: {
    visibleAreaLimit: null, // 無制限（starter/standard と同じ null 表現を踏襲）
    canExportPdf: true,
    canExportCsv: true,
    canExportSheets: true,
    canUseHeatmap: true,
    seatLimit: 20,
    stationLevelEntitled: true,
    marketMetricsEntitled: true,
    townAcquisitionPriority: true,
    areaCompare: true,
    tradeAreaReport: true,
    alerts: true,
    pdfLogo: true,
  },
}

// ------------------------------------------------------------
// guard 層（許可判定の単一入口）。コンポーネント/APIは plan を直書きせず
// canUse(plan, feature) を経由する（§3「許可は plans の1箇所で定義」）。
//   - boolean 系の機能フラグのみ canUse の対象。
//   - 数値系（visibleAreaLimit / seatLimit）は getEntitlement で取得する。
// ------------------------------------------------------------

// PlanEntitlements のうち boolean 値を持つキーだけを抽出した型。
//   canUse はこの型のキーのみ受け付け、数値系キーの誤渡しを型で防ぐ。
export type BooleanEntitlementKey = {
  [K in keyof PlanEntitlements]: PlanEntitlements[K] extends boolean ? K : never
}[keyof PlanEntitlements]

// 指定プランが boolean 系機能を使えるか。未知の plan は free 相当にフォールバック。
export function canUse(plan: PlanId, feature: BooleanEntitlementKey): boolean {
  const ent = PLAN_ENTITLEMENTS[plan] ?? PLAN_ENTITLEMENTS.free
  return ent[feature] === true
}

// 数値系を含む任意のエンタイトルメント値を取得する（visibleAreaLimit / seatLimit 等）。
export function getEntitlement<K extends keyof PlanEntitlements>(
  plan: PlanId,
  key: K,
): PlanEntitlements[K] {
  const ent = PLAN_ENTITLEMENTS[plan] ?? PLAN_ENTITLEMENTS.free
  return ent[key]
}

// プランID → Stripe Price ID（サーバーサイドの Checkout で使用）。
// 該当プランの Price ID が未設定なら null。
export function priceIdForPlan(plan: PaidPlanId): string | null {
  if (plan === 'starter') return process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID ?? null
  if (plan === 'standard') return process.env.NEXT_PUBLIC_STRIPE_STANDARD_PRICE_ID ?? null
  if (plan === 'platinum') return process.env.NEXT_PUBLIC_STRIPE_PLATINUM_PRICE_ID ?? null
  return null
}

// Stripe Price ID から plan を逆引き（Webhook で使用）
export function planFromPriceId(priceId: string | null | undefined): PlanId {
  if (!priceId) return 'free'
  if (priceId === process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID) return 'starter'
  if (priceId === process.env.NEXT_PUBLIC_STRIPE_STANDARD_PRICE_ID) return 'standard'
  if (priceId === process.env.NEXT_PUBLIC_STRIPE_PLATINUM_PRICE_ID) return 'platinum'
  return 'free'
}

// ============================================================
// 正式リリース用 料金プラン（表示専用）
//   Free / Starter / Standard / Platinum の4プラン構成（LP と同順）。
//   先行申込価格（2026年9月30日までのご契約に適用）を主表示し、
//   通常価格を打ち消し表示する Google One 形式。
//   先行申込価格は契約継続中ずっと据え置き。
//
//   ※ これは LP / 料金ページの表示専用データ。実際の課金
//     プラミング（checkout / webhook / subscription）は上記の
//     PlanId / priceIdForPlan / planFromPriceId を使用する。
// ============================================================

export type BetaPlanId = PlanId

export interface BetaPlan {
  id: BetaPlanId
  name: string
  betaPriceLabel: string // 先行申込価格（主表示。2026/9/30 までのご契約に適用）
  // 通常価格（打ち消し表示）。Free は割引対象外のため null（期限バッジも出さない）。
  regularPriceLabel: string | null
  features: string[]
  recommended?: boolean
}

export const BETA_PLANS: BetaPlan[] = [
  {
    id: 'free',
    name: 'Free',
    betaPriceLabel: '¥0',
    regularPriceLabel: null,
    features: ['上位3エリアの閲覧のみ'],
  },
  {
    id: 'starter',
    name: 'Starter',
    betaPriceLabel: '¥30,000',
    regularPriceLabel: '¥50,000',
    features: [
      '都道府県・市区町村レベルのエリアスコア',
      '人口動態グラフ',
      'CSV出力',
      'メールサポート',
    ],
  },
  {
    id: 'standard',
    name: 'Standard',
    betaPriceLabel: '¥50,000',
    regularPriceLabel: '¥100,000',
    features: [
      'Starter の全機能',
      '地図ヒートマップ',
      'PDFレポート',
      'メール優先サポート',
    ],
    recommended: true,
  },
  {
    id: 'platinum',
    name: 'Platinum',
    betaPriceLabel: '¥100,000',
    regularPriceLabel: '¥300,000',
    features: [
      'Standard の全機能',
      'エリア比較',
      'Slack・Zoom サポート',
      'PDFロゴ対応',
    ],
  },
]

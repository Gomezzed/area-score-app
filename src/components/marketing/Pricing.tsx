import type { ReactNode } from 'react'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { CheckoutButton } from '@/components/ui/CheckoutButton'
import { Br } from '@/components/marketing/LineBreak'
import type { PaidPlanId } from '@/lib/plans'

// ⑧ Pricing（ライト）— 正式リリース向け 4プラン構成
//   Free / Starter / Standard / Platinum。Standard を「おすすめ」バッジ＋ボーダーで強調。
//   有料プランは先行申込価格（2026/9/30 までのご契約に適用・契約継続中据え置き）を
//   主表示し、通常価格を打ち消し線で併記する。
//   CTA 配線:
//     - Free / Starter / Standard … 既存 /register へ href 誘導
//     - Platinum … CheckoutButton（POST /api/stripe/checkout → Stripe Checkout）

interface Feature {
  label: string
}

interface PricingPlan {
  id: string
  name: string
  monthly: ReactNode // 月額表示（先行申込価格）
  regular: string | null // 通常価格（打ち消し表示）。Free は割引対象外のため null。
  features: Feature[]
  // checkoutPlan があれば Stripe Checkout（CheckoutButton）、なければ href リンク。
  cta: { label: string; href?: string; checkoutPlan?: PaidPlanId }
  recommended?: boolean
}

const PLANS: PricingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    monthly: '0円',
    regular: null,
    features: [
      { label: '上位3エリアの閲覧のみ' },
      { label: '人口推移グラフ' },
      { label: '駅データ（市区町村の合計）' },
    ],
    cta: { label: '無料で始める', href: '/register?plan=free' },
  },
  {
    id: 'starter',
    name: 'Starter',
    monthly: <>月額30,000円<Br />（税抜）</>,
    regular: '¥50,000',
    features: [
      { label: '都道府県・市区町村レベルのエリアスコア' },
      { label: '人口推移グラフ' },
      { label: 'PDFレポート出力' },
      { label: 'メールサポート' },
    ],
    cta: { label: 'Starterを始める', href: '/register?plan=starter' },
  },
  {
    id: 'standard',
    name: 'Standard',
    monthly: <>月額50,000円<Br />（税抜）</>,
    regular: '¥100,000',
    features: [
      { label: '駅単位データ' },
      { label: '地図ヒートマップ' },
      { label: 'PDF＋CSV出力（Salesforce形式）' },
      { label: 'メール優先サポート' },
    ],
    cta: { label: 'Standardを始める', href: '/register?plan=standard' },
    recommended: true,
  },
  {
    id: 'platinum',
    name: 'Platinum',
    monthly: <>月額100,000円<Br />（税抜）</>,
    regular: '¥300,000',
    features: [
      { label: '町域 仕入れ優先度（注目TOP20）' },
      { label: 'エリア比較' },
      { label: '商圏レポート' },
      { label: 'アラート機能（近日提供）' },
      { label: 'Slack / Zoom サポート' },
      { label: 'PDFロゴ対応' },
    ],
    cta: { label: 'Platinumを始める', checkoutPlan: 'platinum' },
  },
]

export function Pricing() {
  return (
    <section id="pricing" className="bg-page-bg text-slate-900 scroll-mt-16">
      <div className="max-w-6xl mx-auto px-4 py-20 sm:py-24">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <p className="text-brand-700 font-semibold text-sm mb-3">料金プラン</p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
            事業規模に合わせて選べる4プラン。
          </h2>
          <p className="text-brand-700 text-sm mt-4">
            2026年9月30日までにご契約いただいた価格は、<Br />契約継続中ずっと据え置き。今後の通常価格改定の影響を受けません。
          </p>
          <p className="text-slate-500 text-xs mt-3">
            ※ご解約後に再契約された場合、またはプランを変更された場合は、その時点の通常価格が適用されます。
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4 items-stretch">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`relative rounded-2xl p-6 flex flex-col h-full transition-all bg-white ${
                plan.recommended ? 'border-2 border-brand-700' : 'border border-slate-200'
              }`}
            >
              {plan.recommended && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand-700 text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
                  おすすめ
                </span>
              )}

              <h3 className="text-lg font-bold">{plan.name}</h3>

              <div className="mt-4 mb-1">
                <span className="text-2xl font-bold">{plan.monthly}</span>
              </div>
              <p className="text-slate-500 text-xs mb-5 min-h-4">
                {plan.regular ? (
                  <>
                    通常 <span className="line-through text-slate-400">{plan.regular}</span> / 月（税抜）
                  </>
                ) : null}
              </p>

              <ul className="space-y-2.5 mb-6 flex-1">
                {plan.features.map((feat) => (
                  <li key={feat.label} className="flex items-start gap-2 text-sm text-slate-700">
                    <Check className="w-4 h-4 text-brand-700 flex-shrink-0 mt-0.5" />
                    <span>{feat.label}</span>
                  </li>
                ))}
              </ul>

              {plan.cta.checkoutPlan ? (
                <CheckoutButton
                  plan={plan.cta.checkoutPlan}
                  className="w-full text-center rounded-lg px-4 py-2.5 text-sm font-medium transition-colors bg-white hover:bg-brand-100 border border-[#C7D6E4] text-brand-700 mt-auto"
                >
                  {plan.cta.label}
                </CheckoutButton>
              ) : (
                <Link
                  href={plan.cta.href ?? '/register'}
                  className={`w-full text-center rounded-lg px-4 py-2.5 text-sm font-medium transition-colors mt-auto ${
                    plan.recommended
                      ? 'bg-brand-700 hover:bg-brand-500 text-white'
                      : 'bg-white hover:bg-brand-100 border border-[#C7D6E4] text-brand-700'
                  }`}
                >
                  {plan.cta.label}
                </Link>
              )}
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-slate-400 mt-8">
          ※表示価格はすべて税抜です。別途消費税がかかります。プランの変更・解約はダッシュボードからいつでも可能です。
        </p>
      </div>
    </section>
  )
}

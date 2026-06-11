import Link from 'next/link'
import { Check } from 'lucide-react'

// ⑧ Pricing（ダーク）— 料金プラン v2.1
//   Free / Starter / Standard / Platinum。Standard を「人気」バッジ＋ボーダーで強調。
//   年額契約は全プラン20%OFF。
//   🕒 機能は「2026年7月予定」と明記（景表法・優良誤認回避）。
//   CTA 配線:
//     - Free / Starter / Standard … 既存 /register へ href 誘導
//     - Platinum … #contact へのアンカー（お問い合わせ）
//   ※ 既存の Stripe Checkout（/api/stripe/checkout）は変更・複製しない。

interface Feature {
  label: string
  comingSoon?: boolean // 🕒 = 2026年7月予定
}

interface PricingPlan {
  id: string
  name: string
  monthly: string // 月額表示
  annualNote: string | null // 年額20%OFF時の実質月額メモ
  description: string
  features: Feature[]
  cta: { label: string; href: string }
  recommended?: boolean
}

const PLANS: PricingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    monthly: '0円',
    annualNote: null,
    description: 'まずは無料で試したい方に',
    features: [{ label: '上位3エリアの閲覧のみ' }, { label: '1ID' }],
    cta: { label: '無料で始める', href: '/register' },
  },
  {
    id: 'starter',
    name: 'Starter',
    monthly: '月額30,000円（税抜）',
    annualNote: '年額契約で実質 月24,000円（税抜）相当（20%OFF）',
    description: '個人事業主・小規模仲介向け',
    features: [
      { label: '都道府県・市区町村レベルのスコア' },
      { label: 'PDFレポート出力' },
      { label: '1ID' },
      { label: 'メールサポート' },
    ],
    cta: { label: 'Starterを始める', href: '/register' },
  },
  {
    id: 'standard',
    name: 'Standard',
    monthly: '月額50,000円（税抜）',
    annualNote: '年額契約で実質 月40,000円（税抜）相当（20%OFF）',
    description: '中堅仲介会社向け',
    features: [
      { label: '駅単位データ' },
      { label: '地図ヒートマップ' },
      { label: 'PDF＋CSV出力（Salesforce連携）' },
      { label: '5ID' },
      { label: 'メール優先サポート' },
    ],
    cta: { label: 'Standardを始める', href: '/register' },
    recommended: true,
  },
  {
    id: 'platinum',
    name: 'Platinum',
    monthly: '月額100,000円（税抜）',
    annualNote: '年額契約で実質 月80,000円（税抜）相当（20%OFF）',
    description: '大手仲介会社・チェーン展開向け',
    features: [
      { label: 'エリア比較', comingSoon: true },
      { label: '商圏レポート', comingSoon: true },
      { label: 'アラート', comingSoon: true },
      { label: '20ID' },
      { label: 'Slack / Zoom サポート' },
      { label: 'PDFロゴ対応' },
    ],
    cta: { label: 'お問い合わせ', href: '#contact' },
  },
]

export function Pricing() {
  return (
    <section id="pricing" className="bg-slate-900 text-white scroll-mt-16">
      <div className="max-w-6xl mx-auto px-4 py-20 sm:py-24">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <p className="text-blue-400 font-semibold text-sm mb-3">料金プラン</p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
            事業規模に合わせて選べる4プラン。
          </h2>
          <p className="text-slate-400 mt-4">
            <span className="inline-block bg-emerald-500/15 text-emerald-300 text-sm font-semibold rounded-full px-3 py-1">
              年額契約なら全プラン20%OFF
            </span>
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4 items-stretch">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`relative rounded-2xl border p-6 flex flex-col h-full ${
                plan.recommended
                  ? 'border-blue-500 bg-slate-800 ring-1 ring-blue-500/40'
                  : 'border-slate-700 bg-slate-800/60'
              }`}
            >
              {plan.recommended && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
                  人気
                </span>
              )}

              <h3 className="text-lg font-bold">{plan.name}</h3>
              <p className="text-slate-400 text-xs mt-1 min-h-8">{plan.description}</p>

              <div className="mt-4 mb-1">
                <span className="text-2xl font-bold">{plan.monthly}</span>
              </div>
              <p className="text-emerald-300/80 text-[11px] mb-5 min-h-4">
                {plan.annualNote ?? ''}
              </p>

              <ul className="space-y-2.5 mb-6 flex-1">
                {plan.features.map((feat) => (
                  <li key={feat.label} className="flex items-start gap-2 text-sm text-slate-200">
                    <Check className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <span>
                      {feat.label}
                      {feat.comingSoon && (
                        <span className="ml-1 text-amber-400 text-xs font-medium whitespace-nowrap">
                          🕒 2026年7月予定
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>

              {plan.cta.href.startsWith('#') ? (
                <a
                  href={plan.cta.href}
                  className="w-full text-center rounded-lg px-4 py-2.5 text-sm font-medium bg-slate-700 hover:bg-slate-600 text-white transition-colors"
                >
                  {plan.cta.label}
                </a>
              ) : (
                <Link
                  href={plan.cta.href}
                  className={`w-full text-center rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                    plan.recommended
                      ? 'bg-blue-600 hover:bg-blue-500 text-white'
                      : 'bg-slate-700 hover:bg-slate-600 text-white'
                  }`}
                >
                  {plan.cta.label}
                </Link>
              )}
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-slate-500 mt-8">
          ※表示価格はすべて税抜です。別途消費税がかかります。🕒 の機能は2026年7月提供予定で、現時点ではご利用いただけません。
        </p>
      </div>
    </section>
  )
}

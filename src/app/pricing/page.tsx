'use client'

import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { BETA_PLANS } from '@/lib/plans'
import { CheckoutButton } from '@/components/ui/CheckoutButton'
import { MapPin, Check, ArrowLeft } from 'lucide-react'

export default function PricingPage() {
  const { user } = useAuth()

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <MapPin className="w-4 h-4 text-white" />
            </div>
            <span className="text-white font-bold text-lg">エリアスコア</span>
          </Link>
          <Link
            href={user ? '/dashboard' : '/login'}
            className="text-sm text-slate-400 hover:text-white flex items-center gap-1 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {user ? 'ダッシュボード' : 'ログイン'}
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-12 sm:py-16">
        <div className="text-center mb-8">
          <span className="inline-flex items-center gap-2 bg-blue-600/15 border border-blue-500/40 text-blue-300 text-xs font-medium rounded-full px-3 py-1 mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            クローズドβ受付中
          </span>
          <h1 className="text-3xl sm:text-4xl font-bold text-white">料金プラン</h1>
          <p className="text-slate-400 mt-3">
            不動産仲介の意思決定に必要なデータを、最適なプランで。
          </p>
        </div>

        <div className="max-w-2xl mx-auto mb-12 bg-blue-600/10 border border-blue-500/30 rounded-xl px-5 py-3 text-center">
          <p className="text-blue-200 text-sm">
            β期間中のご契約価格は、契約継続中ずっと据え置き。今後の通常価格改定の影響を受けません。
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3 items-start">
          {BETA_PLANS.map((plan) => {
            const highlight = plan.recommended
            return (
              <div
                key={plan.id}
                className={`relative rounded-2xl border p-6 sm:p-8 flex flex-col h-full ${
                  highlight
                    ? 'border-blue-500 bg-slate-800 shadow-2xl shadow-blue-900/30 md:scale-105'
                    : 'border-slate-700 bg-slate-800/60'
                }`}
              >
                {highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                    おすすめ
                  </span>
                )}

                <h2 className="text-lg font-bold text-white">{plan.name}</h2>
                <p className="text-slate-400 text-sm mt-1">{plan.description}</p>

                <div className="mt-5 mb-1 flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-white">{plan.betaPriceLabel}</span>
                  <span className="text-slate-400 text-sm">/月（税抜）</span>
                  <span className="bg-blue-600/20 text-blue-300 text-[11px] font-bold px-1.5 py-0.5 rounded">
                    β特別
                  </span>
                </div>
                <p className="text-slate-500 text-sm mb-6">
                  通常 <span className="line-through">{plan.regularPriceLabel}</span> / 月（税抜）
                </p>

                <ul className="space-y-3 mb-8 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                      <Check className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                {/* 課金対象（Starter / Standard / Platinum）: クライアントで POST → Stripe Checkout へ */}
                <CheckoutButton
                  plan={plan.id}
                  className={`w-full rounded-lg px-4 py-3 font-medium text-center transition-colors ${
                    highlight
                      ? 'bg-blue-600 hover:bg-blue-700 text-white'
                      : 'bg-slate-700 hover:bg-slate-600 text-white'
                  }`}
                >
                  {plan.id === 'platinum' ? '今すぐ申し込む' : `${plan.name}を始める`}
                </CheckoutButton>
                {plan.id === 'platinum' && (
                  // Platinum は導入相談も併存（セルフ決済 + 商談の2導線）。
                  <Link
                    href="/contact"
                    className="mt-3 block w-full text-center text-sm text-slate-400 hover:text-white transition-colors"
                  >
                    導入を相談する
                  </Link>
                )}
              </div>
            )
          })}
        </div>

        <p className="text-center text-slate-500 text-xs mt-10">
          ※表示価格はすべて税抜です。別途消費税がかかります。プランの変更・解約はダッシュボードからいつでも可能です。
        </p>
      </main>
    </div>
  )
}

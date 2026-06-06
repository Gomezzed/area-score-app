'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useSubscription } from '@/hooks/useSubscription'
import { PLANS, type Plan } from '@/lib/plans'
import { MapPin, Check, ArrowLeft, Loader2 } from 'lucide-react'

export default function PricingPage() {
  const router = useRouter()
  const { user } = useAuth()
  const { plan: currentPlan } = useSubscription()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSelect(plan: Plan) {
    setError(null)

    // 無料プラン: ログイン済みならダッシュボード、未ログインなら登録へ
    if (plan.id === 'free') {
      router.push(user ? '/dashboard' : '/register')
      return
    }

    // 未ログインなら登録へ誘導
    if (!user) {
      router.push('/register')
      return
    }

    if (!plan.priceId) {
      setError('このプランは現在準備中です（Stripe Price ID 未設定）。')
      return
    }

    setPendingId(plan.id)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId: plan.priceId, userId: user.id }),
      })
      const data = await res.json()
      if (!res.ok || !data.url) {
        setError(data.error ?? 'チェックアウトを開始できませんでした。')
        setPendingId(null)
        return
      }
      window.location.assign(data.url)
    } catch (err) {
      setError(`通信エラー: ${String(err)}`)
      setPendingId(null)
    }
  }

  function buttonLabel(plan: Plan): string {
    if (plan.id === currentPlan) return '現在のプラン'
    if (plan.id === 'free') return user ? 'ダッシュボードへ' : '無料で始める'
    return 'このプランを選ぶ'
  }

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <MapPin className="w-4 h-4 text-white" />
            </div>
            <span className="text-white font-bold text-lg">エリア人口分析</span>
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
        <div className="text-center mb-12">
          <h1 className="text-3xl sm:text-4xl font-bold text-white">料金プラン</h1>
          <p className="text-slate-400 mt-3">
            不動産営業の意思決定に必要なデータを、最適なプランで。
          </p>
        </div>

        {error && (
          <div className="max-w-2xl mx-auto mb-8 bg-red-900/50 border border-red-700 text-red-300 rounded-lg p-3 text-sm text-center">
            {error}
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-3 items-start">
          {PLANS.map((plan) => {
            const isCurrent = plan.id === currentPlan
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
                    推奨
                  </span>
                )}

                <h2 className="text-lg font-bold text-white">{plan.name}</h2>
                <p className="text-slate-400 text-sm mt-1">{plan.description}</p>

                <div className="mt-4 mb-6">
                  <span className="text-3xl font-bold text-white">{plan.priceLabel}</span>
                  {plan.price > 0 && <span className="text-slate-400 text-sm">/月</span>}
                </div>

                <ul className="space-y-3 mb-8 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                      <Check className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handleSelect(plan)}
                  disabled={isCurrent || pendingId === plan.id}
                  className={`w-full rounded-lg px-4 py-3 font-medium flex items-center justify-center gap-2 transition-colors ${
                    isCurrent
                      ? 'bg-slate-700 text-slate-400 cursor-default'
                      : highlight
                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                        : 'bg-slate-700 hover:bg-slate-600 text-white'
                  }`}
                >
                  {pendingId === plan.id && <Loader2 className="w-4 h-4 animate-spin" />}
                  {buttonLabel(plan)}
                </button>
              </div>
            )
          })}
        </div>

        <p className="text-center text-slate-500 text-xs mt-10">
          表示価格は税別です。プランの変更・解約はダッシュボードからいつでも可能です。
        </p>
      </main>
    </div>
  )
}

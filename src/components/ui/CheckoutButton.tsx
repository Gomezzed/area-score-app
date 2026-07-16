'use client'

import { useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { PaidPlanId } from '@/lib/plans'

interface Props {
  // 課金対象プラン（starter / standard / platinum）。Free はこのボタンを使わない（呼び出し側で出し分け）。
  plan: PaidPlanId
  // 呼び出し側のデザインをそのまま引き継ぐ（料金カードの見た目を壊さないため）。
  className?: string
  children: ReactNode
}

// Starter / Standard / Platinum の課金CTA（クライアント配線）。
//   クリックで POST /api/stripe/checkout に { plan } を送り、返ってきた
//   Stripe Checkout の session.url へ遷移する。
//
//   認証: /api と同一オリジンのため Supabase セッション Cookie は自動送出される
//   （credentials:'same-origin' は既定値だが意図を明示）。route 側は
//   createSupabaseServerClient() が Cookie からユーザーを解決し、未ログインは 401。
//
//   ※ 既存の checkout route.ts（POSTハンドラ）は変更せず、配線のみ。
export function CheckoutButton({ plan, className = '', children }: Props) {
  const [loading, setLoading] = useState(false)

  async function startCheckout() {
    if (loading) return
    setLoading(true)
    try {
      // 認証ゲート: webhook は metadata.supabase_user_id でユーザーを紐付けるため、
      // Checkout 時点でのユーザー確定が必須（匿名Checkout非対応）。未ログインなら
      // POST せず /login へ送り、ログイン後に元ページへ戻して再度CTAを押せるようにする。
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        const redirect = encodeURIComponent(window.location.pathname)
        window.location.assign(`/login?redirect=${redirect}`)
        return // 遷移するので loading は維持（ボタンは押せないまま）
      }

      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      })
      const data = await res.json().catch(() => null)

      if (res.ok && data?.url) {
        // Stripe Checkout へ遷移する。遷移するので loading は解除しない（多重起動防止）。
        window.location.assign(data.url)
        return
      }

      // 失敗（4xx/5xx もしくは url 欠落）: route の error メッセージを優先表示。
      // 既契約ガード等は { error: <code>, message: <日本語> } を返すため message を優先。
      const message =
        data?.message ??
        data?.error ??
        `チェックアウトを開始できませんでした（HTTP ${res.status}）。時間をおいて再度お試しください。`
      window.alert(message)
      setLoading(false)
    } catch (err) {
      window.alert(`通信エラーが発生しました。ネットワーク状況をご確認ください。\n${String(err)}`)
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={startCheckout}
      disabled={loading}
      aria-busy={loading}
      className={`${className} disabled:opacity-70 disabled:cursor-not-allowed`}
    >
      {loading ? (
        <span className="inline-flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          処理中...
        </span>
      ) : (
        children
      )}
    </button>
  )
}

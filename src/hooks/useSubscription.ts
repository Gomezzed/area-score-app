'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { canAccessFull as canAccessFullForPlan, type PlanId } from '@/lib/plans'

// 現在ログイン中ユーザーのサブスクリプションプランを取得する。
// subscriptions テーブルが未作成 / 行が無い / 取得失敗時は 'free' にフォールバックし、
// Stripe 未設定でもダッシュボードが動作するようにする。
export function useSubscription() {
  const [plan, setPlan] = useState<PlanId>('free')
  const [isLoading, setIsLoading] = useState(true)
  // 請求アカウント有無（= stripe_customer_id IS NOT NULL）。コンプ行（stripe 系 NULL）は
  // false になり、UI 側で「請求情報を管理」ボタンを描画しないための判定に使う。
  const [hasBillingAccount, setHasBillingAccount] = useState(false)

  useEffect(() => {
    let mounted = true

    async function load() {
      // セッション初期化完了を待つ（OAuth直後・直接アクセス時のレース対策）。
      // getUser() 自体が初期化を待つが、明示しておく。
      await supabase.auth.getSession()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        if (mounted) {
          setPlan('free')
          setHasBillingAccount(false)
          setIsLoading(false)
        }
        return
      }

      const { data, error } = await supabase
        .from('subscriptions')
        .select('plan, status')
        .eq('user_id', user.id)
        .maybeSingle()

      // テーブル未作成 / エラー / 行なし → free
      const active = !error && !!data && (data.status === 'active' || data.status === 'past_due')
      const nextPlan: PlanId = active ? (data!.plan as PlanId) : 'free'

      // 請求アカウント有無。stripe_customer_id の生値はクライアントへ出さず、
      // NULL 判定を DB 側フィルタで行い「存在するか」だけを受け取る。
      let billing = false
      if (active) {
        const { data: billingRow } = await supabase
          .from('subscriptions')
          .select('user_id')
          .eq('user_id', user.id)
          .not('stripe_customer_id', 'is', null)
          .maybeSingle()
        billing = !!billingRow
      }

      if (mounted) {
        setPlan(nextPlan)
        setHasBillingAccount(billing)
        setIsLoading(false)
      }
    }

    load()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // INITIAL_SESSION: 既存セッションでのページロード時に発火（OAuth後・直接アクセス）。
      // プランは可視エリア数（Free上位N件）を左右するため、誤った free 固定を回復する。
      if (
        (event === 'INITIAL_SESSION' && session) ||
        event === 'SIGNED_IN' ||
        event === 'TOKEN_REFRESHED'
      ) {
        load()
      }
    })
    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  return { plan, isLoading, canAccessFull: canAccessFullForPlan(plan), hasBillingAccount }
}

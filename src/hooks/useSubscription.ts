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

  useEffect(() => {
    let mounted = true

    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        if (mounted) {
          setPlan('free')
          setIsLoading(false)
        }
        return
      }

      const { data, error } = await supabase
        .from('subscriptions')
        .select('plan, status')
        .eq('user_id', user.id)
        .maybeSingle()

      if (mounted) {
        // テーブル未作成 / エラー / 行なし → free
        if (error || !data) {
          setPlan('free')
        } else {
          const active = data.status === 'active' || data.status === 'past_due'
          setPlan(active ? (data.plan as PlanId) : 'free')
        }
        setIsLoading(false)
      }
    }

    load()
    return () => {
      mounted = false
    }
  }, [])

  return { plan, isLoading, canAccessFull: canAccessFullForPlan(plan) }
}

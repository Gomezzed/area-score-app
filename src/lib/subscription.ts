import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { canUse, type BooleanEntitlementKey, type PlanId } from '@/lib/plans'

// ============================================================
// サーバーサイド用サブスクリプション判定ヘルパー。
//   service_role クライアント（RLS バイパス）で subscriptions テーブルを
//   参照し、任意ユーザーの現在のプラン / 有効状態を返す。
//
//   テーブル未作成 / 行なし / 取得失敗時は安全側に 'free'（=未契約）扱い。
// ============================================================

// status が「有効」とみなせるか。
//   active   … 課金中
//   past_due … 支払い遅延中だが猶予期間として閲覧は許可する
const ACTIVE_STATUSES = new Set(['active', 'past_due'])

// 指定ユーザーの現在のプランを返す。
// 有効でない（canceled 等）場合は 'free' を返す。
export async function getUserPlan(userId: string): Promise<PlanId> {
  const admin = getSupabaseAdmin()
  if (!admin) return 'free'

  const { data, error } = await admin
    .from('subscriptions')
    .select('plan, status')
    .eq('user_id', userId)
    .maybeSingle()

  if (error || !data) return 'free'
  if (!ACTIVE_STATUSES.has(data.status)) return 'free'

  // 料金v2.1: platinum を含む全プランIDを正しく通す。
  // （旧実装は platinum を 'free' に取りこぼし、Platinum 契約者の権限が無効化されていた）
  const plan = data.plan as PlanId
  const allowed: readonly PlanId[] = ['free', 'starter', 'standard', 'platinum']
  return allowed.includes(plan) ? plan : 'free'
}

// 指定ユーザーが有効な有料プランを契約しているか。
export async function hasActivePlan(userId: string): Promise<boolean> {
  const plan = await getUserPlan(userId)
  // free 以外（starter / standard / platinum）はすべて有効な有料プラン。
  return plan !== 'free'
}

// ============================================================
// Route Handler 用 機能ガード（許可判定は plans.ts の canUse に集約）。
//   現在ログイン中ユーザーの plan を取得し、指定機能を使えなければ
//   未認証は 401 / プラン不足は 403 の NextResponse を返す。
//   使える場合は null を返し、呼び出し側は
//     const denied = await guardFeature('alerts')
//     if (denied) return denied
//   の形で利用する。各APIへの実配線は T6 で行う（本タスクは guard 関数の実装まで）。
// ============================================================
export async function guardFeature(
  feature: BooleanEntitlementKey,
): Promise<NextResponse | null> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const plan = await getUserPlan(user.id)
  if (!canUse(plan, feature)) {
    return NextResponse.json(
      { error: 'forbidden', requiredFeature: feature, plan },
      { status: 403 },
    )
  }
  return null
}

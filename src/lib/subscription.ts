import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { PlanId } from '@/lib/plans'

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

  const plan = data.plan as PlanId
  return plan === 'light' || plan === 'standard' ? plan : 'free'
}

// 指定ユーザーが有効な有料プランを契約しているか。
export async function hasActivePlan(userId: string): Promise<boolean> {
  const plan = await getUserPlan(userId)
  return plan === 'light' || plan === 'standard'
}

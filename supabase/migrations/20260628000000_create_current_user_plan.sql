-- =====================================================================
-- 20260628000000_create_current_user_plan.sql  (T1 / DB層ヘルパー)
--
-- 目的:
--   現在ログイン中ユーザーの「有効プラン」を返す DB 関数を1か所に定義する。
--   料金v2.1 のプラン×機能マップは src/lib/plans.ts に集約されているが、
--   RLS（DB層のガード）はSQLからプランを判定する必要があるため、
--   アプリ層 getUserPlan() と「完全に同じ判定ロジック」を DB 側に置く。
--
--   このヘルパーは T3 public.town_monthly_metrics の platinum 限定 SELECT
--   ポリシーから参照される。今後 T4 public.market_metrics 等でも再利用する
--   ため、テーブル作成とは独立した単一責務の migration として切り出す。
--   （未作成だったため本タスクで新規作成する＝T1のDB層ヘルパー）
--
-- 判定ロジック（src/lib/subscription.ts getUserPlan と1対1で一致）:
--   1. subscriptions 行が無ければ 'free'
--   2. status が 'active' / 'past_due' 以外なら 'free'（猶予として past_due は許可）
--   3. plan が想定4種（free/starter/standard/platinum）以外なら 'free'
--   4. それ以外は subscriptions.plan をそのまま返す
--
-- セキュリティ:
--   - SECURITY DEFINER: subscriptions の RLS（本人行のみ可）に依存せず、
--     常に auth.uid() の行を確実に読めるようにする。WHERE で auth.uid()
--     に限定しているため他人のプランは参照できない。
--   - search_path を固定し、関数乗っ取り（search_path 経由）を防ぐ。
--   - 未認証（auth.uid() = NULL）や service_role 文脈では行がヒットせず 'free'。
--   - EXECUTE は authenticated / service_role のみ。anon には付与しない。
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.current_user_plan()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN s.status IN ('active', 'past_due')
         AND s.plan   IN ('free', 'starter', 'standard', 'platinum')
        THEN s.plan
        ELSE 'free'
      END
      FROM public.subscriptions s
      WHERE s.user_id = auth.uid()
    ),
    'free'
  );
$$;

COMMENT ON FUNCTION public.current_user_plan() IS
  '現在ログイン中ユーザーの有効プラン(free/starter/standard/platinum)を返す。'
  'src/lib/subscription.ts getUserPlan と同一判定。RLSポリシーのプラン判定に使う。';

-- 公開ロールからの実行権を剥がし、必要なロールにだけ付与する。
REVOKE ALL ON FUNCTION public.current_user_plan() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_plan() TO authenticated, service_role;

COMMIT;

-- =====================================================================
-- 検証クエリ（適用後に手動実行）
--   -- 関数が存在し SECURITY DEFINER であること:
--   SELECT proname, prosecdef
--   FROM pg_proc WHERE proname = 'current_user_plan';
--
--   -- 未認証文脈では 'free' を返すこと（SQL Editor は service_role 文脈）:
--   SELECT public.current_user_plan();   -- 期待値: 'free'
-- =====================================================================

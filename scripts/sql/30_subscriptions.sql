-- =====================================================================
-- scripts/sql/30_subscriptions.sql  （M1-11 / Platinum コンプ付与）
--
-- 目的: 対象34名に Platinum を D20 型コンプ（Stripe 非経由）で付与する。
--       銀行振込のため stripe 関連列は NULL、期限は 2099-12-31（判定には未使用・記録用）。
--
-- 実行順: 25 の後、40 の前。
-- 想定影響行数: 実在ユーザー数（最大 34）。INSERT または ON CONFLICT UPDATE。
-- 冪等性: subscriptions PK=user_id（実測）。ON CONFLICT (user_id) DO UPDATE で上書き。
--         2 回流しても同一結果。
--
-- 付与する実データ（★PM が本番実測した実在コンプ行3件に一致・裁定1）:
--   plan='platinum', status='active',
--   stripe_customer_id=NULL, stripe_subscription_id=NULL,
--   current_period_end='2099-12-31', cancel_at_period_end=false,
--   organization_id=所属法人 org の id（判定には無関係・記録用）。
--
-- 上書き対象列（DO UPDATE・裁定1で指定）:
--   plan / status / current_period_end / cancel_at_period_end / organization_id
--   （＋ updated_at=now() の衛生更新）。
--   ⚠ stripe_customer_id / stripe_subscription_id は DO UPDATE では触らない
--      （既存値があれば温存。新規 INSERT 時のみ NULL）。
--
-- 実行者: PM が Supabase コネクタ（service_role 文脈）で実行。
-- 注意:
--   - ⑤ 既存6行（PO・検証アカウント等）は対応表に無い＝ON CONFLICT が発火せず不変。
--   - プラン判定は subscriptions.user_id を見る（current_user_plan / getUserPlan）。
--     organization_id は判定に無関係（列は記録用）。
--   - ⛔ 破壊的 DELETE なし。free 登録者は行が無い場合があるため必ず UPSERT。
-- =====================================================================

-- ─── 対応表（唯一の正・★PM がここだけ差し替える）─────────────────────────
CREATE TEMP TABLE IF NOT EXISTS m1_11_roster (email text, corp_name text);
TRUNCATE m1_11_roster;
INSERT INTO m1_11_roster (email, corp_name) VALUES
  ('tencho1@example.com', 'サンプル不動産株式会社'),
  ('tencho2@example.com', 'サンプル不動産株式会社');
  -- ここに残り32行を追加（合計34行）
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

INSERT INTO public.subscriptions
  (user_id, plan, status,
   stripe_customer_id, stripe_subscription_id,
   current_period_end, cancel_at_period_end, organization_id)
SELECT
  u.id,
  'platinum',
  'active',
  NULL,                                   -- stripe_customer_id（コンプ＝NULL）
  NULL,                                   -- stripe_subscription_id（コンプ＝NULL）
  TIMESTAMPTZ '2099-12-31 00:00:00+00',   -- current_period_end（判定未使用・記録用）
  false,                                  -- cancel_at_period_end
  o.id                                    -- organization_id（所属法人 org・記録用）
FROM m1_11_roster r
JOIN auth.users u           ON lower(u.email) = lower(r.email)
JOIN public.organizations o ON o.name = r.corp_name AND o.is_personal = false
ON CONFLICT (user_id) DO UPDATE SET
  plan                 = EXCLUDED.plan,
  status               = EXCLUDED.status,
  current_period_end   = EXCLUDED.current_period_end,
  cancel_at_period_end = EXCLUDED.cancel_at_period_end,
  organization_id      = EXCLUDED.organization_id,
  updated_at           = now();

COMMIT;

-- 確認: 対象ユーザーが platinum/active になっているか。
\echo '=== コンプ付与後の対象ユーザー状態（platinum/active が期待） ==='
SELECT r.email, s.plan, s.status,
       s.stripe_customer_id, s.stripe_subscription_id,
       s.current_period_end, s.cancel_at_period_end, s.organization_id
FROM m1_11_roster r
JOIN auth.users u ON lower(u.email) = lower(r.email)
JOIN public.subscriptions s ON s.user_id = u.id
ORDER BY r.corp_name, r.email;

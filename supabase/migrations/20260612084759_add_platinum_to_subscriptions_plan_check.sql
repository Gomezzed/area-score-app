-- #10c: プラン CHECK制約を料金設計v2.1に整合 (free/starter/standard/platinum)
-- 2026-06-12 に Supabase SQL Editor で本番適用済み。本ファイルは履歴整合用。
-- platinum は将来用の枠のみ(Stripe商品・checkout受付は2026/7のPlatinum解放時に対応)

BEGIN;

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_check;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan = ANY (ARRAY['free'::text, 'starter'::text, 'standard'::text, 'platinum'::text]));

COMMIT;

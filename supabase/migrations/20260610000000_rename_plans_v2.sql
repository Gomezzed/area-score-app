-- =====================================================================
-- 20260610000000_rename_plans_v2.sql
-- 料金設計 v2.1: プラン名リネーム 'light' -> 'starter'
--   - subscriptions.plan の CHECK 制約を ('free','starter','standard') に更新
--   - 既存 'light' データを 'starter' へ移行
--   - Platinum は β期間中 Stripe 未作成のため CHECK 制約には含めない
--   - RLS ポリシーは温存（本 migration では一切触れない）
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Step 1: 既存の plan CHECK 制約を動的に DROP
--   制約名が環境で異なっても落とせるよう、列 'plan' に紐づく
--   CHECK 制約を pg_constraint から探して削除する
-- ---------------------------------------------------------------------
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'subscriptions'
      AND nsp.nspname = 'public'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%plan%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.subscriptions DROP CONSTRAINT %I',
      c.conname
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- Step 2: 既存 'light' データを 'starter' へ移行
--   (CHECK 制約を外した後・付け直す前に実行する点が重要)
-- ---------------------------------------------------------------------
UPDATE public.subscriptions
SET plan = 'starter'
WHERE plan = 'light';

-- ---------------------------------------------------------------------
-- Step 3: 新しい CHECK 制約を付与
--   β実装は Free / Starter / Standard の3プランのみ。
--   Platinum は Stripe 商品作成（2026/7）時に別 migration で追加する。
-- ---------------------------------------------------------------------
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan IN ('free', 'starter', 'standard'));

-- ---------------------------------------------------------------------
-- Step 4: 既存行のデフォルト値が 'light' になっていた場合に備えて
--   列デフォルトを 'free' に明示（任意・安全側）
-- ---------------------------------------------------------------------
ALTER TABLE public.subscriptions
  ALTER COLUMN plan SET DEFAULT 'free';

COMMIT;

-- =====================================================================
-- 検証クエリ（migration 後に手動実行して確認）
--   SELECT plan, count(*) FROM public.subscriptions GROUP BY plan;
--   -> 'light' が 0 件、'starter' に移っていれば成功
-- =====================================================================

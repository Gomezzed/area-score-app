-- =====================================================================
-- 20260814100300_step1_org_id_not_null.sql
-- STEP1 / SD-3: organization_id を NOT NULL 化する（最終段）。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う。
-- 適用順: STEP1 の最後。100200 の RLS 切替と verify（step1_verify_org_rls.sql）合格後。
-- ⚠ 適用条件:
--   - backfill 完了で 3 テーブルの organization_id null 残 = 0
--   - step1_verify_org_rls.sql の検証マトリクス（同一 org 可視／別 org 不可視／件数一致）合格
--   ※ null 残があると SET NOT NULL は失敗する。必ず backfill/verify 後に適用する。
-- =====================================================================

BEGIN;

ALTER TABLE public.customer_lists
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE public.customer_list_rows
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE public.subscriptions
  ALTER COLUMN organization_id SET NOT NULL;

COMMIT;

-- =====================================================================
-- 検証クエリ（適用後に手動実行）
--   SELECT table_name, is_nullable FROM information_schema.columns
--   WHERE table_schema='public' AND column_name='organization_id'
--     AND table_name IN ('customer_lists','customer_list_rows','subscriptions');
--   -- 期待: すべて is_nullable = 'NO'
-- =====================================================================

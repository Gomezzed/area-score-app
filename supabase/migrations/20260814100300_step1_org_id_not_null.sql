-- =====================================================================
-- 20260814100300_step1_org_id_not_null.sql
-- STEP1 / SD-3: organization_id を NOT NULL 化する（最終段）。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う。
-- 適用順: STEP1 の最後。100200 の RLS 切替と verify（step1_verify_org_rls.sql）合格後。
-- ⚠ 適用条件:
--   - backfill 完了で customer_lists / customer_list_rows の organization_id null 残 = 0
--   - step1_verify_org_rls.sql の検証マトリクス（同一 org 可視／別 org 不可視／件数一致）合格
--   ※ null 残があると SET NOT NULL は失敗する。必ず backfill/verify 後に適用する。
--
-- 対象は customer_lists / customer_list_rows の2テーブルのみ（subscriptions は除外）。
-- 【subscriptions を NOT NULL 化しない理由】
--   subscriptions は Stripe Webhook が service_role で insert する
--   （src/app/api/stripe/webhook/route.ts）。service_role 実行時は auth.uid() が NULL の
--   ため default_org_id() も NULL となり、NOT NULL 化すると決済成功後のプラン付与が失敗する。
--   org課金を実装する将来STEPで、Webhook側の organization_id 明示セットとセットで再検討する。
-- =====================================================================

BEGIN;

ALTER TABLE public.customer_lists
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE public.customer_list_rows
  ALTER COLUMN organization_id SET NOT NULL;

-- subscriptions.organization_id は NOT NULL 化しない（上記理由参照・列は nullable のまま）。

COMMIT;

-- =====================================================================
-- 検証クエリ（適用後に手動実行）
--   SELECT table_name, is_nullable FROM information_schema.columns
--   WHERE table_schema='public' AND column_name='organization_id'
--     AND table_name IN ('customer_lists','customer_list_rows','subscriptions');
--   -- 期待: customer_lists / customer_list_rows = 'NO'、subscriptions = 'YES'（nullable のまま）
-- =====================================================================

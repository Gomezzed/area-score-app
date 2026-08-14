-- =====================================================================
-- 20260814100200_step1_switch_customer_rls_to_org.sql
-- STEP1 / SD-3: customer_lists / customer_list_rows の RLS を org 方針へ切替。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う。
-- 適用順: backfill（scripts/sql/step1_backfill_personal_orgs.sql）完了の直後。
-- ⚠ 適用条件: customer_lists / customer_list_rows の organization_id null 残 = 0 で
--             あること（backfill 検証 SELECT で確認済み）。null 残があると
--             SELECT ポリシーで当該行が不可視になるため、必ず backfill 後に適用する。
--
-- 新方針:
--   読み取り(SELECT)          = 同一 org 共有（organization_id ∈ 自分の所属 org）
--   書き込み(INSERT/UPDATE/DELETE) = 作成者本人（user_id = auth.uid()）AND org 一致
--   user_id 列は「作成者」の意味で存続する。
--   関数呼び出しは IN (SELECT public.current_user_org_ids()) で initplan 化する。
--
-- 備考: customer_lists / customer_list_rows に service_role 専用ポリシーは存在しない
--       （service_role は RLS バイパスで運用）。DROP 対象は下記 user_id 系 8 本のみ。
-- =====================================================================

BEGIN;

-- ── 旧 user_id 系ポリシーを名前指定で DROP（20260808000000 由来の 8 本）──────
DROP POLICY IF EXISTS "cl_select_own" ON public.customer_lists;
DROP POLICY IF EXISTS "cl_insert_own" ON public.customer_lists;
DROP POLICY IF EXISTS "cl_update_own" ON public.customer_lists;
DROP POLICY IF EXISTS "cl_delete_own" ON public.customer_lists;

DROP POLICY IF EXISTS "clr_select_own" ON public.customer_list_rows;
DROP POLICY IF EXISTS "clr_insert_own" ON public.customer_list_rows;
DROP POLICY IF EXISTS "clr_update_own" ON public.customer_list_rows;
DROP POLICY IF EXISTS "clr_delete_own" ON public.customer_list_rows;

-- ── customer_lists: 新ポリシー ────────────────────────────────────────
-- SELECT: 同一 org 共有
DROP POLICY IF EXISTS "cl_select_org" ON public.customer_lists;
CREATE POLICY "cl_select_org" ON public.customer_lists
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.current_user_org_ids()));

-- INSERT: 作成者本人 AND org 一致
DROP POLICY IF EXISTS "cl_insert_org" ON public.customer_lists;
CREATE POLICY "cl_insert_org" ON public.customer_lists
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (SELECT public.current_user_org_ids())
    AND user_id = (select auth.uid())
  );

-- UPDATE: 作成者本人 AND org 一致（USING/WITH CHECK 双方）
DROP POLICY IF EXISTS "cl_update_org" ON public.customer_lists;
CREATE POLICY "cl_update_org" ON public.customer_lists
  FOR UPDATE TO authenticated
  USING (
    user_id = (select auth.uid())
    AND organization_id IN (SELECT public.current_user_org_ids())
  )
  WITH CHECK (
    user_id = (select auth.uid())
    AND organization_id IN (SELECT public.current_user_org_ids())
  );

-- DELETE: 作成者本人 AND org 一致
DROP POLICY IF EXISTS "cl_delete_org" ON public.customer_lists;
CREATE POLICY "cl_delete_org" ON public.customer_lists
  FOR DELETE TO authenticated
  USING (
    user_id = (select auth.uid())
    AND organization_id IN (SELECT public.current_user_org_ids())
  );

-- ── customer_list_rows: 新ポリシー ────────────────────────────────────
-- SELECT: 同一 org 共有
DROP POLICY IF EXISTS "clr_select_org" ON public.customer_list_rows;
CREATE POLICY "clr_select_org" ON public.customer_list_rows
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.current_user_org_ids()));

-- INSERT: 作成者本人 AND org 一致
DROP POLICY IF EXISTS "clr_insert_org" ON public.customer_list_rows;
CREATE POLICY "clr_insert_org" ON public.customer_list_rows
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (SELECT public.current_user_org_ids())
    AND user_id = (select auth.uid())
  );

-- UPDATE: 作成者本人 AND org 一致（USING/WITH CHECK 双方）
DROP POLICY IF EXISTS "clr_update_org" ON public.customer_list_rows;
CREATE POLICY "clr_update_org" ON public.customer_list_rows
  FOR UPDATE TO authenticated
  USING (
    user_id = (select auth.uid())
    AND organization_id IN (SELECT public.current_user_org_ids())
  )
  WITH CHECK (
    user_id = (select auth.uid())
    AND organization_id IN (SELECT public.current_user_org_ids())
  );

-- DELETE: 作成者本人 AND org 一致
DROP POLICY IF EXISTS "clr_delete_org" ON public.customer_list_rows;
CREATE POLICY "clr_delete_org" ON public.customer_list_rows
  FOR DELETE TO authenticated
  USING (
    user_id = (select auth.uid())
    AND organization_id IN (SELECT public.current_user_org_ids())
  );

-- subscriptions のポリシーは触らない（列追加のみ。課金判定・RLS は不変）。

COMMIT;

-- =====================================================================
-- 検証クエリ（適用後に手動実行）
--   -- ポリシー一覧（各テーブル SELECT/INSERT/UPDATE/DELETE の 4 件が *_org になっていること）:
--   SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE schemaname='public' AND tablename IN ('customer_lists','customer_list_rows')
--   ORDER BY tablename, cmd;
--   -- 詳細な検証は scripts/sql/step1_verify_org_rls.sql（BEGIN〜ROLLBACK）で行う。
-- =====================================================================

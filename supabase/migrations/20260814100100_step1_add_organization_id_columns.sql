-- =====================================================================
-- 20260814100100_step1_add_organization_id_columns.sql
-- STEP1 / SD-3: customer_lists / customer_list_rows / subscriptions に
--               organization_id（当面 nullable）を追加する。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う。
-- 適用順: (1) 100000 の直後（backfill より前）。100000 が適用済みであること。
-- 適用条件: 20260814100000_step1_create_organizations.sql 適用済み。
--
-- 方針:
--   - アプリコード無変更で organization_id を充足させるため、
--     customer_lists.organization_id にカラム DEFAULT（default_org_id()）を設定し、
--     customer_list_rows は BEFORE INSERT トリガーで親リストの org_id をコピーする。
--   - NOT NULL 化は本ファイルでは行わない（backfill+verify 後に 100300 で実施）。
-- =====================================================================

BEGIN;

-- ── 所属 org を1件返す関数（カラム DEFAULT 用）──────────────────────────
-- INSERT 実行者（authenticated）の所属 org を is_personal 優先・古い順で1件返す。
-- SECURITY DEFINER・stable・search_path 固定・EXECUTE 権限は current_user_org_ids と同一。
CREATE OR REPLACE FUNCTION public.default_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT om.organization_id
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE om.user_id = (select auth.uid())
  ORDER BY o.is_personal DESC, o.created_at ASC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.default_org_id() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.default_org_id() TO authenticated, service_role;

COMMENT ON FUNCTION public.default_org_id() IS
  'STEP1: INSERT 実行者の既定 org（is_personal 優先・created_at 昇順で1件）。customer_lists.organization_id の DEFAULT。';

-- ── organization_id 列追加（nullable）────────────────────────────────
ALTER TABLE public.customer_lists
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id);

-- customer_lists は実行者の既定 org を DEFAULT に。アプリ無変更で新規 INSERT が充足される。
ALTER TABLE public.customer_lists
  ALTER COLUMN organization_id SET DEFAULT public.default_org_id();

ALTER TABLE public.customer_list_rows
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id);

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id);

CREATE INDEX IF NOT EXISTS customer_lists_org_idx
  ON public.customer_lists (organization_id);
CREATE INDEX IF NOT EXISTS customer_list_rows_org_idx
  ON public.customer_list_rows (organization_id);

COMMENT ON COLUMN public.customer_lists.organization_id IS
  'STEP1: 所属テナント。DEFAULT public.default_org_id()。当面 nullable、backfill+verify 後に NOT NULL 化。';
COMMENT ON COLUMN public.customer_list_rows.organization_id IS
  'STEP1: 所属テナント。BEFORE INSERT トリガーで親リストからコピー（親子 org 不一致を構造的に防止）。';
COMMENT ON COLUMN public.subscriptions.organization_id IS
  'STEP1: 所属テナント（列追加のみ・課金ロジックは不変）。当面 nullable。';

-- ── customer_list_rows: 親リストから organization_id を継承するトリガー ──────
-- organization_id が未指定(null)なら、親 customer_lists.organization_id をコピーする。
-- FK 列名は実測どおり list_id。親子の org 不一致を構造的に防ぐ。
CREATE OR REPLACE FUNCTION public.set_customer_list_row_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT cl.organization_id
      INTO NEW.organization_id
    FROM public.customer_lists cl
    WHERE cl.id = NEW.list_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_customer_list_row_org() FROM public, anon;

DROP TRIGGER IF EXISTS trg_set_customer_list_row_org ON public.customer_list_rows;
CREATE TRIGGER trg_set_customer_list_row_org
  BEFORE INSERT ON public.customer_list_rows
  FOR EACH ROW EXECUTE FUNCTION public.set_customer_list_row_org();

COMMENT ON FUNCTION public.set_customer_list_row_org() IS
  'STEP1: customer_list_rows.organization_id が null なら親リスト(list_id)の org_id を継承。親子 org 一致を保証。';

COMMIT;

-- =====================================================================
-- 検証クエリ（適用後に手動実行）
--   -- 列存在:
--   SELECT table_name, column_name, is_nullable FROM information_schema.columns
--   WHERE table_schema='public' AND column_name='organization_id'
--     AND table_name IN ('customer_lists','customer_list_rows','subscriptions');
--   -- DEFAULT:
--   SELECT column_default FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='customer_lists' AND column_name='organization_id';
--   -- トリガー:
--   SELECT tgname FROM pg_trigger WHERE tgrelid='public.customer_list_rows'::regclass
--     AND tgname='trg_set_customer_list_row_org';
-- =====================================================================

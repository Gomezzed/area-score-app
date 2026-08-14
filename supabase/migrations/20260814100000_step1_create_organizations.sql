-- =====================================================================
-- 20260814100000_step1_create_organizations.sql
-- STEP1 / 決定 SD-3: organizations（テナント）を学校区機能の前に導入する。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う。
--
-- 適用順（本 STEP1 全体）:
--   (1) 100000 organizations（本ファイル）
--   (2) 100100 organization_id 列追加（nullable）
--   (3) scripts/sql/step1_backfill_personal_orgs.sql を dry-run → 承認 → 本実行
--   (4) 100200 customer_lists 系 RLS を org 方針へ切替【適用条件: backfill 完了で null 残 0】
--   (5) scripts/sql/step1_verify_org_rls.sql を実行（BEGIN〜ROLLBACK の読み取り検証）
--   (6) 100300 organization_id を NOT NULL 化【適用条件: verify 合格後】
--
-- 適用条件（本ファイル）: 前提なし。STEP1 の最初に適用する。
--
-- 方針:
--   - テナント単位 = organization。既存ユーザー全員に個人 org(is_personal=true) を
--     backfill で自動生成し、以後の新規サインアップはトリガーで自動生成する。
--   - 読み取り=同一 org 共有／書き込み=作成者本人のみ（user_id = auth.uid()）AND org 一致。
--   - current_user_org_ids() は SECURITY DEFINER・stable・search_path 固定・
--     EXECUTE は authenticated / service_role のみ（既存 get_*_gated RPC の
--     ハードニングパターンを踏襲。anon には付与しない）。
--   - authenticated への書き込みは organizations / organization_members とも許可しない。
--     メンバーシップ作成は backfill（service_role）とサインアップトリガー（definer）経由のみ。
-- =====================================================================

BEGIN;

-- ── テナント本体 ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  is_personal BOOLEAN NOT NULL DEFAULT false,   -- 個人 org（1ユーザー専用テナント）
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.organizations IS
  'STEP1/SD-3: テナント。is_personal=true は個人 org（既存ユーザー backfill / 新規サインアップで自動生成）。';

-- ── メンバーシップ ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organization_members (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id)          ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'owner'
                    CHECK (role IN ('owner', 'admin', 'member')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

-- user_id 単独での逆引き（current_user_org_ids / default_org_id が引く）用インデックス。
CREATE INDEX IF NOT EXISTS organization_members_user_idx
  ON public.organization_members (user_id);

COMMENT ON TABLE public.organization_members IS
  'STEP1: ユーザー↔org の所属。PK=(organization_id, user_id)。role=owner/admin/member。';

-- ── 所属 org 集合を返す関数（RLS の initplan 用の単一出所）────────────────
-- SECURITY DEFINER で organization_members を参照し、呼び出しユーザーの所属 org を返す。
-- RLS ポリシー内では IN (SELECT public.current_user_org_ids()) で initplan 化する。
CREATE OR REPLACE FUNCTION public.current_user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT organization_id
  FROM public.organization_members
  WHERE user_id = (select auth.uid())
$$;

-- 既定の PUBLIC/anon への EXECUTE を剥奪し、authenticated / service_role のみに付与。
REVOKE ALL ON FUNCTION public.current_user_org_ids() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.current_user_org_ids() TO authenticated, service_role;

COMMENT ON FUNCTION public.current_user_org_ids() IS
  'STEP1: 呼び出しユーザーが所属する organization_id の集合。RLS で IN (SELECT ...) にして initplan 化する。';

-- ── RLS: 読み取りのみ許可（書き込みは definer/service_role 経由に限定）─────────
ALTER TABLE public.organizations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- 既定の anon/authenticated への広い付与を剥奪し、authenticated に SELECT のみ付与。
REVOKE ALL ON public.organizations        FROM anon, authenticated;
REVOKE ALL ON public.organization_members FROM anon, authenticated;
GRANT  SELECT ON public.organizations        TO authenticated;
GRANT  SELECT ON public.organization_members TO authenticated;

-- organizations: 自分が所属する org のみ SELECT 可。
DROP POLICY IF EXISTS "org_select_member" ON public.organizations;
CREATE POLICY "org_select_member" ON public.organizations
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.current_user_org_ids()));

-- organization_members: 自分が所属する org のメンバー行のみ SELECT 可。
DROP POLICY IF EXISTS "orgm_select_member" ON public.organization_members;
CREATE POLICY "orgm_select_member" ON public.organization_members
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.current_user_org_ids()));

-- INSERT/UPDATE/DELETE ポリシーは authenticated には作らない（作成は definer/service_role のみ）。

-- ── 新規サインアップ時の個人 org 自動生成 ────────────────────────────────
-- auth.users への INSERT 後に、個人 org（name=email のローカル部）と owner メンバーシップを
-- 冪等（on conflict do nothing）に作成する。security definer・search_path 固定。
CREATE OR REPLACE FUNCTION public.handle_new_user_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id  uuid;
  v_local   text;
BEGIN
  -- 既に個人 org を持つ場合は何もしない（冪等）。
  SELECT om.organization_id
    INTO v_org_id
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE om.user_id = NEW.id
    AND o.is_personal = true
  LIMIT 1;

  IF v_org_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- name = email のローカル部（@ より前）。email が無い場合は 'user' を代替。
  v_local := split_part(coalesce(NEW.email, ''), '@', 1);
  IF v_local = '' THEN
    v_local := 'user';
  END IF;

  INSERT INTO public.organizations (name, is_personal)
  VALUES (v_local, true)
  RETURNING id INTO v_org_id;

  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (v_org_id, NEW.id, 'owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- anon/PUBLIC から直接呼べないよう EXECUTE を剥奪（トリガー実行は所有者権限で行われる）。
REVOKE ALL ON FUNCTION public.handle_new_user_org() FROM public, anon;

DROP TRIGGER IF EXISTS on_auth_user_created_org ON auth.users;
CREATE TRIGGER on_auth_user_created_org
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_org();

COMMENT ON FUNCTION public.handle_new_user_org() IS
  'STEP1: 新規 auth.users に個人 org(is_personal=true, name=email ローカル部) と owner メンバーシップを冪等作成。';

COMMIT;

-- =====================================================================
-- 検証クエリ（適用後に手動実行）
--   -- テーブル/RLS:
--   SELECT relname, relrowsecurity FROM pg_class
--   WHERE oid IN ('public.organizations'::regclass, 'public.organization_members'::regclass);
--   -- 関数の EXECUTE 権限（anon に無いこと）:
--   SELECT proname, proacl FROM pg_proc WHERE proname='current_user_org_ids';
--   -- トリガー存在:
--   SELECT tgname FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND tgname='on_auth_user_created_org';
-- =====================================================================

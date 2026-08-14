-- =====================================================================
-- scripts/sql/step1_verify_org_rls.sql
-- STEP1 / SD-3: org 移行後の RLS 可視性を読み取り検証する。
--
-- 【実行は PM が行う】適用順: migration 100200（RLS 切替）適用後、100300（NOT NULL）より前。
-- 全体を BEGIN 〜 ROLLBACK で包み、本番にデータの痕跡を残さない（作成→検証→巻き戻し）。
-- UUID はハードコードせず email から auth.users を引く。
--   PO  = info@crouchingstyle.com（platinum・customer_lists 5 本の所有者）
--   TU1 = rmitachinow4@gmail.com（別ユーザー・別 org）
--
-- ユーザー切替:
--   set_config('request.jwt.claims', ...'sub'=<uuid>..., true) で auth.uid() を差し替え、
--   SET LOCAL ROLE authenticated で RLS を実際に効かせる。
--   auth.users を引く必要のある処理は RESET ROLE（＝実行ロール）で行う。
--
-- 検証マトリクス（期待値は各コメント参照）:
--   a) PO: 自分の customer_lists = 5 本／customer_list_town_latest が非 0（ビュー回帰）
--   b) TU1: PO のリストが 0 件（別 org 不可視）
--   c) 一時 org＋PO/TU1 両名メンバーシップ＋TU1 名義の一時リスト → 双方から可視（同一 org 可視）
--   d) service_role 視点の総数 = 移行前実測（customer_lists=5 / customer_list_rows=38）
-- =====================================================================

BEGIN;

-- ── UUID を GUC に退避（role 切替後も参照できるようにする）───────────────────
SELECT set_config('step1.po_id',
         (SELECT id::text FROM auth.users WHERE email = 'info@crouchingstyle.com'), true);
SELECT set_config('step1.tu1_id',
         (SELECT id::text FROM auth.users WHERE email = 'rmitachinow4@gmail.com'), true);

-- 前提チェック: 両ユーザーが解決できること（NULL なら email を PM が確認）。
SELECT 'precheck: user ids resolved' AS label,
       current_setting('step1.po_id',  true) AS po_id,     -- NOT NULL 期待
       current_setting('step1.tu1_id', true) AS tu1_id;    -- NOT NULL 期待

-- =====================================================================
-- a) PO 視点（platinum）
-- =====================================================================
SELECT set_config('request.jwt.claims',
         json_build_object('sub', current_setting('step1.po_id'),
                           'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

SELECT 'a) PO customer_lists visible' AS label, count(*) AS n
FROM public.customer_lists;                                 -- 期待 5（PO 個人 org のリスト）

SELECT 'a) PO view customer_list_town_latest' AS label, count(*) AS n
FROM public.customer_list_town_latest;                      -- 期待 > 0（ビュー回帰・platinum 継承）

RESET ROLE;

-- =====================================================================
-- b) TU1 視点（別 org）: PO のリストは見えない
-- =====================================================================
SELECT set_config('request.jwt.claims',
         json_build_object('sub', current_setting('step1.tu1_id'),
                           'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

SELECT 'b) TU1 sees PO-owned lists' AS label, count(*) AS n
FROM public.customer_lists
WHERE user_id = current_setting('step1.po_id')::uuid;       -- 期待 0（別 org 不可視）

SELECT 'b) TU1 total visible lists' AS label, count(*) AS n
FROM public.customer_lists;                                 -- 期待: TU1 自身の org のリストのみ（PO の 5 は含まない）

RESET ROLE;

-- =====================================================================
-- d) service_role（実行ロール = RLS バイパス）視点の総数
--    ※ c) の一時行を作る前に測る。
-- =====================================================================
SELECT 'd) service_role totals' AS label,
       (SELECT count(*) FROM public.customer_lists)     AS cl_total,   -- 期待 5
       (SELECT count(*) FROM public.customer_list_rows) AS clr_total;  -- 期待 38

-- =====================================================================
-- c) 同一 org 可視: 一時 org に PO/TU1 両名を入れ、TU1 名義の一時リストを作る
--    → PO からも TU1 からも同一リストが 1 件見える（ROLLBACK で消滅）。
-- =====================================================================
-- 一時 org を作成し id を退避
WITH o AS (
  INSERT INTO public.organizations (name, is_personal)
  VALUES ('__step1_verify_tmp_org__', false)
  RETURNING id
)
SELECT set_config('step1.tmp_org', (SELECT id::text FROM o), true);

-- 両名を一時 org のメンバーに（PO=member / TU1=owner）
INSERT INTO public.organization_members (organization_id, user_id, role)
VALUES
  (current_setting('step1.tmp_org')::uuid, current_setting('step1.po_id')::uuid,  'member'),
  (current_setting('step1.tmp_org')::uuid, current_setting('step1.tu1_id')::uuid, 'owner');

-- TU1 名義で一時 org にリストを1本作成し id を退避
WITH l AS (
  INSERT INTO public.customer_lists (user_id, name, organization_id)
  VALUES (current_setting('step1.tu1_id')::uuid,
          '__step1_verify_tmp_list__',
          current_setting('step1.tmp_org')::uuid)
  RETURNING id
)
SELECT set_config('step1.tmp_list', (SELECT id::text FROM l), true);

-- PO 視点: 一時リストが見える
SELECT set_config('request.jwt.claims',
         json_build_object('sub', current_setting('step1.po_id'),
                           'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT 'c) PO sees shared-org tmp list' AS label, count(*) AS n
FROM public.customer_lists
WHERE id = current_setting('step1.tmp_list')::uuid;         -- 期待 1（同一 org 可視）
RESET ROLE;

-- TU1 視点: 同じ一時リストが見える
SELECT set_config('request.jwt.claims',
         json_build_object('sub', current_setting('step1.tu1_id'),
                           'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT 'c) TU1 sees shared-org tmp list' AS label, count(*) AS n
FROM public.customer_lists
WHERE id = current_setting('step1.tmp_list')::uuid;         -- 期待 1（同一 org 可視）
RESET ROLE;

-- ── 痕跡を残さない ────────────────────────────────────────────────────
ROLLBACK;

-- =====================================================================
-- 期待値まとめ:
--   a) PO lists = 5 / view > 0
--   b) TU1 が見る PO リスト = 0 / TU1 total に PO の 5 は含まれない
--   c) PO・TU1 とも tmp list = 1（同一 org 可視）
--   d) service_role: customer_lists=5 / customer_list_rows=38
-- =====================================================================

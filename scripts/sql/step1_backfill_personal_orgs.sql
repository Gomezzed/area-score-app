-- =====================================================================
-- scripts/sql/step1_backfill_personal_orgs.sql
-- STEP1 / SD-3: 既存ユーザーへの個人 org backfill＋既存データの org_id 充足。
--
-- 【実行は PM が行う】適用順: migration 100000・100100 適用後、100200（RLS 切替）より前。
-- 冪等（何度実行しても結果不変）。service_role で実行する（RLS バイパス前提）。
-- service_role キーは本ファイルに置かない（接続は PM の環境で行う）。
--
-- dry-run: 末尾の「検証 SELECT（dry-run 用）」だけを先に実行し、対象件数を確認してから
--          本体（BEGIN〜COMMIT）を実行する。
--
-- 手順:
--   1) 個人 org を持たない全 auth.users に org＋owner メンバーシップを作成
--   2) customer_lists.organization_id を所有者の個人 org で埋める（null 行のみ）
--   3) customer_list_rows を親リストからコピー（null 行のみ）
--   4) subscriptions を該当ユーザーの個人 org で埋める（null 行のみ）
--   5) 検証 SELECT（null 残 0／個人 org 数＝users 数／メンバーシップ数＝users 数／総行数不変）
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 【dry-run 用】本体実行前に、これらを単体で実行して規模を把握する（副作用なし）。
--   -- 個人 org を持たないユーザー数（= これから作成される org 数）:
--   SELECT count(*) AS users_without_personal_org
--   FROM auth.users u
--   WHERE NOT EXISTS (
--     SELECT 1 FROM public.organization_members om
--     JOIN public.organizations o ON o.id = om.organization_id
--     WHERE om.user_id = u.id AND o.is_personal = true
--   );
--   -- 充足対象の残 null 行数:
--   SELECT
--     (SELECT count(*) FROM public.customer_lists     WHERE organization_id IS NULL) AS cl_null,
--     (SELECT count(*) FROM public.customer_list_rows WHERE organization_id IS NULL) AS clr_null,
--     (SELECT count(*) FROM public.subscriptions      WHERE organization_id IS NULL) AS sub_null;
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) 個人 org を持たない全ユーザーに org＋owner メンバーシップを作成 ────────
-- 冪等性: 既に個人 org を持つユーザーは NOT EXISTS で除外。
-- org には user_id 列が無く、一括 INSERT の RETURNING で user↔org を安全に対応付けられない
-- （org.id 順と user_id 順は無関係で対応がずれる）。ユーザー単位のループで確実に紐付ける。
DO $$
DECLARE
  r     record;
  v_org uuid;
BEGIN
  FOR r IN
    SELECT u.id AS user_id,
           coalesce(nullif(split_part(coalesce(u.email, ''), '@', 1), ''), 'user') AS org_name
    FROM auth.users u
    WHERE NOT EXISTS (
      SELECT 1 FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE om.user_id = u.id AND o.is_personal = true
    )
  LOOP
    INSERT INTO public.organizations (name, is_personal)
    VALUES (r.org_name, true)
    RETURNING id INTO v_org;

    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (v_org, r.user_id, 'owner')
    ON CONFLICT (organization_id, user_id) DO NOTHING;
  END LOOP;
END $$;

-- ── 2) customer_lists.organization_id を所有者の個人 org で埋める（null のみ）──
UPDATE public.customer_lists cl
SET organization_id = po.organization_id
FROM (
  SELECT om.user_id, om.organization_id
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE o.is_personal = true
) po
WHERE cl.organization_id IS NULL
  AND cl.user_id = po.user_id;

-- ── 3) customer_list_rows を親リストからコピー（null のみ）────────────────
UPDATE public.customer_list_rows clr
SET organization_id = cl.organization_id
FROM public.customer_lists cl
WHERE clr.organization_id IS NULL
  AND clr.list_id = cl.id;

-- ── 4) subscriptions を該当ユーザーの個人 org で埋める（null のみ）───────────
UPDATE public.subscriptions s
SET organization_id = po.organization_id
FROM (
  SELECT om.user_id, om.organization_id
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE o.is_personal = true
) po
WHERE s.organization_id IS NULL
  AND s.user_id = po.user_id;

COMMIT;

-- =====================================================================
-- 5) 検証 SELECT（本体 COMMIT 後に実行。すべて期待どおりであることを確認）
--
--   -- (a) 3 テーブルの organization_id null 残 = 0
--   SELECT
--     (SELECT count(*) FROM public.customer_lists     WHERE organization_id IS NULL) AS cl_null,     -- 期待 0
--     (SELECT count(*) FROM public.customer_list_rows WHERE organization_id IS NULL) AS clr_null,    -- 期待 0
--     (SELECT count(*) FROM public.subscriptions      WHERE organization_id IS NULL) AS sub_null;    -- 期待 0
--
--   -- (b) 個人 org 数 = auth.users 数／メンバーシップ数 = auth.users 数
--   SELECT
--     (SELECT count(*) FROM public.organizations WHERE is_personal = true) AS personal_orgs,          -- 期待 = users
--     (SELECT count(*) FROM public.organization_members om
--        JOIN public.organizations o ON o.id = om.organization_id
--        WHERE o.is_personal = true)                                       AS personal_memberships,   -- 期待 = users
--     (SELECT count(*) FROM auth.users)                                    AS users;                  -- 基準
--
--   -- (c) 各テーブル総行数が backfill 前後で不変（UPDATE は行を増減しない）
--   --     backfill 前に控えた値と一致すること（実測基準: customer_lists=5 / customer_list_rows=38）:
--   SELECT
--     (SELECT count(*) FROM public.customer_lists)     AS cl_total,     -- 期待 5（不変）
--     (SELECT count(*) FROM public.customer_list_rows) AS clr_total,    -- 期待 38（不変）
--     (SELECT count(*) FROM public.subscriptions)      AS sub_total;    -- 前後不変
-- =====================================================================

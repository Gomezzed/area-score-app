-- =====================================================================
-- verify_bm1_schema.sql
-- 購入希望マッチ（BM）PR-BM-1 の適用後 検証 SELECT 集（PM が手動実行する）。
--   対象 migration:
--     20260908000100_bm_property_types_lead_type.sql
--     20260908000200_bm_desired_districts_match.sql
--   すべて SELECT のみ（DB を変更しない）。psql / Supabase コネクタで実行する。
--
-- ⚠ 事前構文検証（適用前・05 §6-1-1 ステップ3）── PM 手動:
--   本 PR は SECURITY DEFINER 関数と RLS を含むため、適用前に「捨て名＋ROLLBACK」で
--   構文だけを確認できる。関数名を __preflight_ に置き換えて BEGIN…ROLLBACK し、残存 0 件を確かめる:
--     BEGIN;
--       -- 20260908000200 の (5)(6) を、関数名だけ __preflight_normalize_school_name /
--       -- __preflight_match_customer_list_desired_districts に置換して貼り付け、構文を通す。
--       -- （テーブル/トリガー/RLS は本適用で確認するため、preflight では関数 2 本の CREATE のみを対象にする）
--     ROLLBACK;
--     -- 残存 0 件の確認:
--     SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--     WHERE n.nspname='public' AND p.proname LIKE '\_\_preflight\_%';  -- 期待: 0 行
-- =====================================================================


-- =====================================================================
-- (A) 3 テーブルの列一覧
-- =====================================================================
SELECT table_name, ordinal_position, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN ('property_types',
                     'customer_list_row_property_types',
                     'customer_list_row_desired_districts')
ORDER BY table_name, ordinal_position;


-- =====================================================================
-- (B) CHECK 制約（pg_constraint）
-- =====================================================================
SELECT c.conrelid::regclass AS tbl, c.conname, pg_get_constraintdef(c.oid) AS def
FROM pg_constraint c
WHERE c.conrelid IN (
        'public.property_types'::regclass,
        'public.customer_list_row_property_types'::regclass,
        'public.customer_list_row_desired_districts'::regclass)
  AND c.contype IN ('c','p','f','u')
ORDER BY tbl, c.contype, c.conname;

-- customer_list_rows の CHECK（lead_type が増え、match_status は不変）。
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid='public.customer_list_rows'::regclass AND contype='c'
ORDER BY conname;
-- 期待: customer_list_rows_lead_type_check / customer_list_rows_match_status_check の 2 本。


-- =====================================================================
-- (C) 索引（pg_indexes）
-- =====================================================================
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname='public'
  AND tablename IN ('property_types',
                    'customer_list_row_property_types',
                    'customer_list_row_desired_districts',
                    'customer_list_rows')
ORDER BY tablename, indexname;
-- 期待（抜粋）: customer_list_rows_list_lead_type_idx ... (list_id, lead_type) WHERE (deleted_at IS NULL)


-- =====================================================================
-- (D) RLS ポリシーの三表横並び（clrg_* / clrpt_* / clrdd_* が cmd ごとに同一述語）
-- =====================================================================
-- cmd ごとに qual / with_check が 3 テーブルで一致することを目視する。
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname='public'
  AND tablename IN ('customer_list_row_geocodes',
                    'customer_list_row_property_types',
                    'customer_list_row_desired_districts')
ORDER BY cmd, tablename, policyname;
-- 期待: 各 cmd（SELECT/INSERT/UPDATE/DELETE）で 3 行、qual/with_check が一字一句同じ。
--       roles は {authenticated}。

-- 既存 customer_list_rows の RLS 4 本が不変であること（緩めていない証拠）。
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname='public' AND tablename='customer_list_rows'
ORDER BY cmd;
-- 期待: clr_select_org / clr_insert_org / clr_update_org / clr_delete_org（適用前と同じ）。


-- =====================================================================
-- (E) GRANT（子 2 表は authenticated=SELECT のみ・anon は 0 件）
-- =====================================================================
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public'
  AND table_name IN ('property_types',
                     'customer_list_row_property_types',
                     'customer_list_row_desired_districts')
ORDER BY table_name, grantee, privilege_type;
-- 期待: 各表 authenticated=SELECT のみ。anon は 1 件も出ない。


-- =====================================================================
-- (F) トリガー（子 2 表の所有情報上書きトリガーが set_customer_list_row_child_owner）
-- =====================================================================
SELECT t.tgrelid::regclass AS tbl, t.tgname,
       CASE WHEN (t.tgtype & 2) <> 0 THEN 'BEFORE' ELSE 'AFTER' END AS timing,
       CASE WHEN (t.tgtype & 4) <> 0 THEN 'INSERT ' ELSE '' END
       || CASE WHEN (t.tgtype & 16) <> 0 THEN 'UPDATE ' ELSE '' END AS events,
       p.proname AS func
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid IN (
        'public.customer_list_row_property_types'::regclass,
        'public.customer_list_row_desired_districts'::regclass)
  AND NOT t.tgisinternal
ORDER BY tbl, t.tgname;
-- 期待: 両表に BEFORE / INSERT UPDATE の 1 本ずつ。func=set_customer_list_row_child_owner。
--       trg_set_customer_list_row_property_type_owner / trg_set_customer_list_row_desired_district_owner。


-- =====================================================================
-- (G) 関数属性（pg_proc）
-- =====================================================================
SELECT p.proname,
       p.prosecdef                              AS security_definer,
       p.provolatile                            AS volatile,   -- i=immutable / s=stable / v=volatile
       array_to_string(p.proconfig, ',')        AS proconfig,
       pg_get_function_result(p.oid)            AS result,
       count(*) OVER (PARTITION BY p.proname)   AS overloads
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN ('normalize_school_name',
                    'match_customer_list_desired_districts',
                    'set_customer_list_row_child_owner')
ORDER BY p.proname;
-- 期待:
--   normalize_school_name                  : security_definer=f / volatile=i / proconfig に search_path=public, pg_temp / result=text / overloads=1
--   match_customer_list_desired_districts  : security_definer=t / volatile=v / proconfig に search_path=public, pg_temp / result=jsonb / overloads=1
--   set_customer_list_row_child_owner      : security_definer=t / volatile=v / proconfig に search_path=public, pg_temp / result=trigger / overloads=1


-- =====================================================================
-- (H) 関数 EXECUTE 権限（aclexplode）
-- =====================================================================
-- proacl が NULL（＝所有者のみ・GRANT/REVOKE 前の既定）だと aclexplode は 0 行を返すため、
-- proacl の生値も併記して「明示的に付与された grantee」を確認する（地雷㉞）。
SELECT p.proname,
       (aclexplode(p.proacl)).grantee::regrole AS grantee,
       (aclexplode(p.proacl)).privilege_type   AS priv
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN ('normalize_school_name',
                    'match_customer_list_desired_districts',
                    'set_customer_list_row_child_owner')
ORDER BY p.proname, grantee;
-- 期待:
--   normalize_school_name                  : authenticated=EXECUTE のみ（anon/service_role/public は無い）
--   match_customer_list_desired_districts  : service_role=EXECUTE のみ（anon/authenticated/public は無い）
--   set_customer_list_row_child_owner      : public/anon に EXECUTE が無い（REVOKE 済み）

-- 0 行になった場合の別経路（proacl の生値を目視）。
SELECT p.proname, p.proacl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN ('normalize_school_name',
                    'match_customer_list_desired_districts',
                    'set_customer_list_row_child_owner')
ORDER BY p.proname;


-- =====================================================================
-- (I) normalize_school_name のテスト表（入力→期待・一致 boolean・冪等）
-- =====================================================================
SELECT input, expected,
       public.normalize_school_name(input) AS actual,
       public.normalize_school_name(input) = expected AS ok,
       public.normalize_school_name(public.normalize_school_name(input))
         = public.normalize_school_name(input) AS idempotent
FROM (VALUES
  ('岡崎市立六名小学校', '六名'),
  ('六名小',            '六名'),
  ('六名小学校区',      '六名'),
  ('　六名　小学校　',  '六名'),      -- 全角/半角空白の除去
  ('立花小学校',        '立花'),
  ('岡崎市立立花小学校','立花'),
  ('花立小学校',        '花立'),      -- 「花立」は接頭辞「〜立」ではない（先頭に市町村区/組合＋立が無い）
  ('野市小学校',        '野市'),      -- 接尾辞「小」だけを剥がして「野」にしない（小学校を優先除去）
  ('ﾛｸﾒｲ小',           'ロクメイ'),  -- NFKC（半角カナ→全角）＋接尾辞「小」除去
  ('六ッ美中部小学校', '六ッ美中部'),
  ('六ッ美中部小',      '六ッ美中部'),
  ('岡崎市立六ッ美中部小学校','六ッ美中部')
) AS t(input, expected);
-- 期待: 全行 ok=t / idempotent=t。空文字は返さない。


-- =====================================================================
-- (J) property_types の件数 6 と code 一覧
-- =====================================================================
SELECT count(*) AS n FROM public.property_types;   -- 期待: 6
SELECT code, label_ja, segment, sort_order, is_active
FROM public.property_types ORDER BY sort_order;
-- 期待: new_detached/used_detached/new_condo/used_condo/land/commercial（segment=residential×5 + commercial×1）。


-- =====================================================================
-- (K) customer_list_rows.lead_type の分布（適用直後は全行 'unknown'）
-- =====================================================================
SELECT lead_type, count(*) FROM public.customer_list_rows GROUP BY 1 ORDER BY 1;
-- 期待: unknown=全件（buy / sell は 0）。backfill しないため。


-- =====================================================================
-- (L) customer_list_rows の RLS 4 本と CHECK が適用前後で不変であること
-- =====================================================================
-- （D 節で RLS を、B 節で CHECK を出している。ここで両者を 1 クエリにまとめて確認する）
SELECT 'rls' AS kind, policyname AS name, cmd::text AS detail
FROM pg_policies
WHERE schemaname='public' AND tablename='customer_list_rows'
UNION ALL
SELECT 'check' AS kind, conname AS name, pg_get_constraintdef(oid) AS detail
FROM pg_constraint
WHERE conrelid='public.customer_list_rows'::regclass AND contype='c'
ORDER BY kind, name;
-- 期待: rls=clr_select_org/clr_insert_org/clr_update_org/clr_delete_org（不変）、
--       check=customer_list_rows_lead_type_check（新規）+ customer_list_rows_match_status_check（不変）。
--       トリガー（trg_set_customer_list_row_org / trg_touch_customer_list_rows_updated_at）も増減なし:
SELECT tgname FROM pg_trigger
WHERE tgrelid='public.customer_list_rows'::regclass AND NOT tgisinternal ORDER BY 1;

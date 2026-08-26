-- =====================================================================
-- verify_list_areas_rpc.sql
-- M2-6b / SD-44: public.get_customer_list_areas RPC の適用後 検証（PM 用）。
--   SELECT のみ / DDL・DML は書かない。BEGIN/COMMIT・INSERT・UPDATE は含めない。
--
-- ⚠ 適用は PM。migration(20260826000100_list_areas_rpc.sql)を Supabase コネクタで
--    適用したうえで、台帳 supabase_migrations.schema_migrations への INSERT を忘れない。
--
-- 本ファイルは scripts/sql/ に正式配置済み（慣例配置＝verify_school_district_heatmap.sql
--    と同じ場所）。migration 末尾の「検証SQL:」コメントもここを指す。
-- =====================================================================

-- ① prosecdef / provolatile / proconfig の確認
--    期待: prosecdef=false(INVOKER) / provolatile='s'(STABLE) /
--          proconfig に "search_path=public, pg_temp"(extensions を含まないこと) /
--          args = (uuid, text)
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,   -- 期待: p_list_id uuid, p_school_type text
  p.prosecdef,                 -- false であること(INVOKER)
  p.provolatile,               -- 's'(STABLE)
  p.proconfig                  -- {search_path=public, pg_temp}
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_customer_list_areas';

-- ② aclexplode による grantee 展開 + proacl が NULL でないことの確認
--    期待: grantee は 'authenticated'(＋関数所有者)のみ。
--          ⛔ 'service_role'(O109 再発検知)・'anon'・'public' が現れないこと。
--    ⚠ proacl が NULL の場合は「権限なし」ではなく "デフォルト権限" を意味する。
--       REVOKE ALL を明示した本関数では proacl は NULL にならない(下の has_acl=true)想定。
SELECT
  p.proname,
  (p.proacl IS NOT NULL) AS has_acl,   -- 期待: true（NULL はデフォルト権限＝REVOKE 未反映の疑い）
  p.proacl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_customer_list_areas';

-- ②' ACL を 1 行=1grantee に展開して機械的に確認する補助クエリ。
--     期待: grantee は authenticated と関数所有者のみ（2 行）。
--           ⛔ service_role / anon / public は 0 件（現れたら O109 再発）。
SELECT (aclexplode(p.proacl)).grantee::regrole AS grantee,
       (aclexplode(p.proacl)).privilege_type   AS privilege
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_customer_list_areas'
ORDER BY grantee;

-- ③ pg_get_function_result による返り列の確認（生件数が無いこと）
--    期待: "muni_code_5 text, muni_name text, prefecture_name text,
--           has_school_districts boolean" の 4 列のみ。
--          ⛔ count / n / 生件数を意味する列が存在しないこと（索引の秘匿要件）。
SELECT
  p.proname,
  pg_get_function_result(p.oid) AS result_columns
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_customer_list_areas';

-- ④ 関数名でのオーバーロード数が 1 であることの確認
--    期待: count = 1（(uuid, text) の 1 定義のみ。旧シグネチャの残骸が無いこと）。
SELECT count(*) AS overload_count
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_customer_list_areas';

-- ⑤ 既存 RPC get_school_districts_geojson(text, text) の ACL に service_role が
--    居ないこと（O109 残件是正の確認）。
--    期待: grantee に 'service_role' が 0 件。
SELECT (aclexplode(p.proacl)).grantee::regrole AS grantee,
       (aclexplode(p.proacl)).privilege_type   AS privilege
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_school_districts_geojson'
ORDER BY grantee;

-- ⑥ データ検証クエリ（PM の本番目視用）。
--    SELECT * FROM public.get_customer_list_areas('<list_id>');
--    ⚠ postgres ロール(SQL エディタの既定)では current_user_plan() が 'free' に
--       落ちるため 0 行になる。これは正常。データ検証は PO の本番目視(platinum の
--       実ユーザーセッション)で行う。
-- SELECT * FROM public.get_customer_list_areas('00000000-0000-0000-0000-000000000000');
-- SELECT * FROM public.get_customer_list_areas('00000000-0000-0000-0000-000000000000', 'junior_high');

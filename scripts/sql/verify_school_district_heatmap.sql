-- =====================================================================
-- scripts/sql/verify_school_district_heatmap.sql
-- M2-6a / PR-A-1: get_school_district_heatmap RPC の適用後 検証。
--   SELECT のみ / DDL・DML は書かない。BEGIN/COMMIT・INSERT・UPDATE は含めない。
--
-- ⚠ 適用は PM。migration(20260825000100_add_get_school_district_heatmap.sql)を
--    Supabase コネクタで適用したうえで、台帳
--    supabase_migrations.schema_migrations への INSERT を忘れないこと。
--    (この検証 SQL 自体は関数を呼ばない＝反響データに依存せず、宣言だけを確認する)
-- =====================================================================

-- ① prosecdef と proconfig の確認
--    期待: prosecdef = false (SECURITY INVOKER)
--          proconfig に "search_path=public, pg_temp"(extensions を含まないこと)
--          provolatile = 's' (STABLE)
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,
  p.prosecdef,                 -- false であること(INVOKER)
  p.provolatile,               -- 's'(STABLE)
  p.proconfig                  -- {search_path=public, pg_temp}
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_school_district_heatmap';

-- ② proacl(ACL)の確認
--    期待: authenticated=X(EXECUTE)のみ。
--          ⛔ service_role が現れないこと・anon が現れないこと・PUBLIC(=先頭 "=X")が無いこと。
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,
  p.proacl                     -- 例: {gomez=X/gomez, authenticated=X/gomez}
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_school_district_heatmap';

-- ②' ACL を1行=1grantee に展開して機械的に確認する補助クエリ。
--    期待: grantee に 'service_role' も 'anon' も 'public' も現れないこと。
SELECT (aclexplode(p.proacl)).grantee::regrole AS grantee,
       (aclexplode(p.proacl)).privilege_type   AS privilege
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_school_district_heatmap'
ORDER BY grantee;

-- ③ 返り値の列に生件数(count)が無いことの確認
--    期待: 返り列は school_district_id, school_name, muni_code_5, muni_name,
--          tier, attribution_text の6列のみ。
--          ⛔ count / n / 生件数を意味する列が存在しないこと(k=5 抑止の秘匿要件)。
SELECT
  proargnames,                 -- 入力+OUT の名前一覧(count/n が含まれないこと)
  proallargtypes,              -- 型一覧
  proargmodes                  -- 't'=TABLE(OUT)列 / 'i'=IN
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_school_district_heatmap';

-- ③' 戻り値の列名・型・順序を information_schema で人間可読に確認する補助クエリ。
--     期待: 6 行(上記6列)のみ。count/n を意味する行が 0 件であること。
SELECT r.parameter_name, r.data_type, r.ordinal_position
FROM information_schema.routines rt
JOIN information_schema.parameters r ON r.specific_name = rt.specific_name
WHERE rt.routine_schema = 'public'
  AND rt.routine_name = 'get_school_district_heatmap'
  AND r.parameter_mode = 'OUT'
ORDER BY r.ordinal_position;

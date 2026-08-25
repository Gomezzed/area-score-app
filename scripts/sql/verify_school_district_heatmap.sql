-- =====================================================================
-- scripts/sql/verify_school_district_heatmap.sql
-- M2-6a / PR-D(SD-43): get_school_district_heatmap RPC の適用後 検証。
--   SELECT のみ / DDL・DML は書かない。BEGIN/COMMIT・INSERT・UPDATE は含めない。
--
-- ⚠ 適用は PM。migration(20260825000200_heatmap_add_muni_scope.sql)を
--    Supabase コネクタで適用したうえで、台帳
--    supabase_migrations.schema_migrations への INSERT を忘れないこと。
--    (この検証 SQL 自体は関数を呼ばない＝反響データに依存せず、宣言だけを確認する)
--
--   ★PR-D で新シグネチャ (uuid, text, text, text) に変わった。旧 (uuid, text, text) は
--     DROP 済みで存在しないのが期待状態(下記 ① の args で確認)。
-- =====================================================================

-- ① prosecdef と proconfig の確認
--    期待: prosecdef = false (SECURITY INVOKER)
--          proconfig に "search_path=public, pg_temp"(extensions を含まないこと)
--          provolatile = 's' (STABLE)
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,   -- 期待: p_list_id uuid, p_school_type text, p_mode text, p_muni_code_5 text (= (uuid, text, text, text))
  p.prosecdef,                 -- false であること(INVOKER)
  p.provolatile,               -- 's'(STABLE)
  p.proconfig                  -- {search_path=public, pg_temp}
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_school_district_heatmap';

-- ② proacl(ACL)の確認
--    期待: authenticated=X(EXECUTE)のみ。
--          ⛔ service_role が現れないこと(O109: 新規 public 関数へ service_role の EXECUTE が
--             自動付与されるのを migration 側の REVOKE で剥がした。ここに service_role が
--             現れたら REVOKE 漏れ＝O109 の再発)。
--          ⛔ anon が現れないこと・PUBLIC(=先頭 "=X")が無いこと。
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,
  p.proacl                     -- 例: {gomez=X/gomez, authenticated=X/gomez}
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_school_district_heatmap';

-- ②' ACL を1行=1grantee に展開して機械的に確認する補助クエリ。
--    期待: grantee は 'authenticated' のみ(＋関数所有者)。
--          ⛔ 'service_role'(O109 の再発検知)も 'anon' も 'public' も現れないこと。
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
  proargnames,                 -- 入力(p_list_id,p_school_type,p_mode,p_muni_code_5)+OUT の名前一覧(count/n が含まれないこと)
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

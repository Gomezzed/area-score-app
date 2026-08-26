-- =====================================================================
-- verify_school_districts_geojson_id.sql
-- get_school_districts_geojson の properties への 'id' 追加を適用後に検証する（PM 用）。
--   ①〜⑤ は SELECT のみ（メタ情報の確認）。
--   ⑥ のみ BEGIN; SET LOCAL ROLE authenticated; ... ROLLBACK; でデータを確認する
--   （ロールを一時的に authenticated へ切替えて RLS を効かせるため。ROLLBACK で必ず戻す）。
--
-- ⚠ 適用は PM。migration(20260826000200_school_districts_geojson_add_id.sql)を
--    Supabase コネクタで適用したうえで、台帳 supabase_migrations.schema_migrations
--    への INSERT を忘れない。
-- =====================================================================

-- ① prosecdef = false（SECURITY INVOKER であること）
--    期待: prosecdef = false。⛔ true(DEFINER)なら RLS 迂回で非公開校区が漏れる。
SELECT
  p.proname,
  p.prosecdef AS is_security_definer   -- 期待: false
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_school_districts_geojson';

-- ② provolatile = 's'（STABLE であること）
--    期待: provolatile = 's'。
SELECT
  p.proname,
  p.provolatile   -- 期待: 's'(STABLE)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_school_districts_geojson';

-- ③ proconfig に search_path=public, extensions, pg_temp が入っていること
--    期待: proconfig に "search_path=public, extensions, pg_temp"。
--          （本関数は PostGIS を使うため extensions を含む点が list-areas RPC と異なる。）
SELECT
  p.proname,
  p.proconfig   -- 期待: {search_path=public, extensions, pg_temp}
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_school_districts_geojson';

-- ④ aclexplode(proacl) の grantee に service_role が存在しないこと
--    期待: grantee は authenticated と関数所有者のみ。
--          ⛔ service_role / anon / public が現れないこと。
--    ⚠ proacl::text の文字列一致では判定しない。aclexplode で 1 行=1grantee に展開する。
SELECT (aclexplode(p.proacl)).grantee::regrole AS grantee,
       (aclexplode(p.proacl)).privilege_type   AS privilege
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_school_districts_geojson'
ORDER BY grantee;

-- ④' service_role が grantee に 0 件であることを機械的に数える補助クエリ。
--     期待: service_role_grantee_count = 0。
SELECT count(*) AS service_role_grantee_count
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace,
     LATERAL aclexplode(p.proacl) AS a
WHERE n.nspname = 'public'
  AND p.proname = 'get_school_districts_geojson'
  AND a.grantee::regrole::text = 'service_role';

-- ⑤ 同名関数のオーバーロードが 1 本だけであること
--    期待: overload_count = 1（(text, text) の 1 定義のみ。旧シグネチャの残骸が無いこと）。
SELECT count(*) AS overload_count
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_school_districts_geojson';

-- ⑥ データ検証：features の各 properties に 'id' キーが存在し値が NULL でないことを数える。
--    ⛔ 個別の校区名・件数の羅列は出さない。集計値（本数）のみ返す。
--    期待: features_total = features_with_id_key = features_id_not_null（すべて一致）。
--    ⚠ authenticated ロールへ一時切替して RLS(is_public=true)を効かせる。ROLLBACK で必ず戻す。
BEGIN;
SET LOCAL ROLE authenticated;

SELECT
  count(*)                                                       AS features_total,
  count(*) FILTER (WHERE feat -> 'properties' ? 'id')            AS features_with_id_key,
  count(*) FILTER (WHERE (feat -> 'properties' ->> 'id') IS NOT NULL) AS features_id_not_null
FROM jsonb_array_elements(
       public.get_school_districts_geojson('23202', 'elementary') -> 'features'
     ) AS feat;

ROLLBACK;

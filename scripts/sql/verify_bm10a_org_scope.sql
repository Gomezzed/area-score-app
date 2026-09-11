-- =====================================================================
-- scripts/sql/verify_bm10a_org_scope.sql
-- PR-BM-10a / Tier1: 購入希望マッチ RPC の org スコープ対応 適用後 検証。
--   対象（いずれも CREATE OR REPLACE で置換・シグネチャ不変）:
--     public.get_buyer_match_summary(uuid, text, uuid, text, integer, integer)  RETURNS jsonb  / STABLE
--     public.get_buyer_match_cards  (uuid, text, uuid, text, integer, integer)  RETURNS jsonb  / VOLATILE
--     public.get_customer_list_areas(uuid, text)                                RETURNS TABLE  / STABLE
--   （migration: supabase/migrations/20260912000100_bm10a_buyer_match_org_scope.sql）
--
-- SELECT のみ / DDL・DML は書かない。BEGIN/COMMIT・INSERT・UPDATE は含めない。
-- ⛔ 関数は呼ばない（本ファイルは宣言・権限・返り値構造だけをカタログで確認する）。
--    実データの値・件数は一切出力しない（真偽と構造のみ・D144: 集計値のみ可）。
--
-- ⚠ 適用は PM。migration を Supabase コネクタで適用したうえで、台帳
--    supabase_migrations.schema_migrations への INSERT を忘れないこと（版番号 20260912000100）。
-- ⚠ 構文パースは PM が pglast で行う。
-- =====================================================================


-- ── ① 3本の宣言（prosecdef / provolatile / proconfig / オーバーロード数）─────
--    期待（1行ずつ・計3行）:
--      get_buyer_match_summary : prosecdef=false / provolatile='s' / proconfig に search_path=public, pg_temp / overloads=1
--      get_buyer_match_cards   : prosecdef=false / provolatile='v' / proconfig に search_path=public, pg_temp / overloads=1
--      get_customer_list_areas : prosecdef=false / provolatile='s' / proconfig に search_path=public, pg_temp / overloads=1
--    ⚠ proconfig は {"search_path=public, pg_temp"}。extensions を含まないこと。
SELECT
  p.proname,
  count(*) OVER (PARTITION BY p.proname) AS overloads,   -- 期待 1
  p.prosecdef,                                           -- 期待 false（SECURITY INVOKER）
  p.provolatile,                                         -- summary/areas='s' / cards='v'
  p.proconfig                                            -- 期待 search_path を含む
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_buyer_match_summary', 'get_buyer_match_cards', 'get_customer_list_areas')
ORDER BY p.proname;


-- ── ② シグネチャ（引数リスト）が不変であること ───────────────────────────
--    期待:
--      get_buyer_match_summary : uuid, text, uuid, text, integer, integer
--      get_buyer_match_cards   : uuid, text, uuid, text, integer, integer
--      get_customer_list_areas : uuid, text DEFAULT 'elementary'::text
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS identity_args,
  pg_get_function_arguments(p.oid)          AS full_args   -- DEFAULT を含む
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_buyer_match_summary', 'get_buyer_match_cards', 'get_customer_list_areas')
ORDER BY p.proname;


-- ── ③ 返り値の型・構造が増えていないこと ─────────────────────────────────
--    ③-a summary / cards は jsonb を返す（TABLE 列は持たない）。期待 prorettype='jsonb'。
--        ⚠ jsonb の内部キーはカタログから introspection できない。キー集合は
--          c1 の COMMENT に列挙した通りで、BM-4/BM-9a から増減していないことを
--          migration の diff（この PR では jsonb_build_object を変更していない）で担保する。
SELECT
  p.proname,
  pg_get_function_result(p.oid) AS result_type   -- 期待: jsonb
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_buyer_match_summary', 'get_buyer_match_cards')
ORDER BY p.proname;

--    ③-b areas は RETURNS TABLE。出力列が 4 列（muni_code_5 / muni_name /
--        prefecture_name / has_school_districts）のみで増えていないこと。
--        期待: out_columns = 'muni_code_5 text, muni_name text, prefecture_name text, has_school_districts boolean'
SELECT
  p.proname,
  pg_get_function_result(p.oid) AS out_columns
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_customer_list_areas';


-- ── ④ proacl(ACL) の NULL 判定 ───────────────────────────────────────────
--    ⚠ 地雷㉞/L38: proacl IS NULL は「デフォルト権限のまま（PUBLIC 実行可の疑い）」を意味し、
--       aclexplode は 0 行を返す。⑤ の aclexplode だけでは NULL を見逃すため、ここで別途 NULL を判定する。
--    期待: 3本とも acl_is_null=false（REVOKE/GRANT が効いていれば proacl は非 NULL）。
SELECT
  p.proname,
  p.proacl,
  (p.proacl IS NULL) AS acl_is_null   -- 期待 false。true なら REVOKE/GRANT が効いていない＝要調査。
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_buyer_match_summary', 'get_buyer_match_cards', 'get_customer_list_areas')
ORDER BY p.proname;


-- ── ⑤ proacl の grantee 展開（PUBLIC / anon / service_role が居ないこと）─────
--    期待: 各関数に対し authenticated=EXECUTE の行のみ。
--          PUBLIC(grantee=0 / '-')・anon・service_role の EXECUTE 行が 1 件も現れないこと（O109 再発検知）。
SELECT
  p.proname,
  (aclexplode(p.proacl)).grantee::regrole AS grantee,
  (aclexplode(p.proacl)).privilege_type   AS privilege
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_buyer_match_summary', 'get_buyer_match_cards', 'get_customer_list_areas')
ORDER BY p.proname, grantee;

--    ⑤' 禁止 grantee の件数（明示チェック）。期待: forbidden_grants = 0。
--        PUBLIC は aclexplode では grantee=0 として現れる（規約上 EXECUTE を持たせない）。
SELECT
  p.proname,
  count(*) FILTER (
    WHERE (aclexplode(p.proacl)).grantee::regrole::text IN ('anon', 'service_role')
       OR (aclexplode(p.proacl)).grantee = 0        -- PUBLIC
  ) AS forbidden_grants   -- 期待 0
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_buyer_match_summary', 'get_buyer_match_cards', 'get_customer_list_areas')
GROUP BY p.proname
ORDER BY p.proname;


-- ── ⑥ org スコープの本文パッチが入っていること（ソース確認・真偽のみ）───────
--    prosrc に (p_list_id IS NULL OR …) の分岐が入り、旧 list_id 直絞りが
--    「唯一の絞り」ではなくなっていること（真偽のみ。本文そのものは出力しない）。
--    期待: has_null_branch=true。cards は has_org_optin=true（org_optin CTE の存在）。
SELECT
  p.proname,
  (position('p_list_id IS NULL OR' IN p.prosrc) > 0) AS has_null_branch,   -- 3本とも期待 true
  (p.proname = 'get_buyer_match_cards')
    = (position('org_optin' IN p.prosrc) > 0)         AS org_optin_only_in_cards,  -- 期待 true
  -- cards の多層防御（裁定51b）: per-row EXISTS(buyer_match_cards_opt_in) が残っていること。
  (p.proname <> 'get_buyer_match_cards')
    OR (position('buyer_match_cards_opt_in' IN p.prosrc) > 0) AS cards_keeps_perrow_optin  -- 期待 true
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_buyer_match_summary', 'get_buyer_match_cards', 'get_customer_list_areas')
ORDER BY p.proname;

-- =====================================================================
-- 判定サマリ（PM 用・すべて満たせば PASS）:
--   ① 3行・prosecdef=false / provolatile=(s,v,s) / proconfig に search_path / overloads=1
--   ② identity_args が 3本とも不変
--   ③ summary/cards=jsonb・areas は 4 出力列のみ
--   ④ acl_is_null=false（3本）
--   ⑤ authenticated=EXECUTE のみ・⑤' forbidden_grants=0（3本）
--   ⑥ has_null_branch=true（3本）/ org_optin は cards のみ / cards は per-row opt_in を維持
-- =====================================================================

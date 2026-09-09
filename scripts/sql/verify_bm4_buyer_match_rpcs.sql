-- =====================================================================
-- scripts/sql/verify_bm4_buyer_match_rpcs.sql
-- PR-BM-4 / Tier1: 購入希望マッチ 照合 RPC 3本の適用後 検証。
--   対象: public.get_buyer_match_summary / get_buyer_match_cells / get_buyer_match_rows
--   （migration: supabase/migrations/20260909000300_bm4_buyer_match_rpcs.sql）
--
-- SELECT のみ / DDL・DML は書かない。BEGIN/COMMIT・INSERT・UPDATE は含めない。
--
-- ⚠ 適用は PM。migration を Supabase コネクタで適用したうえで、台帳
--    supabase_migrations.schema_migrations への INSERT を忘れないこと。
--    ①〜④ は関数を呼ばない（反響データに依存せず宣言だけを確認する）。
--    ⑤〜⑨ は実データで関数を呼ぶ。⛔ 実行結果の個票（⑨）は完了報告・コミット
--    メッセージ・Slack 等に貼らないこと（D144: 集計値のみ可）。
--
-- ★シグネチャは3本とも (uuid, text, uuid, text, integer, integer)。
-- =====================================================================


-- ── ① prosecdef / provolatile / proconfig の確認 ─────────────────────
--    期待（3本とも）:
--      prosecdef    = false   (SECURITY INVOKER)
--      provolatile  = 's'     (STABLE)
--      proconfig    = {"search_path=public, pg_temp"}（extensions を含まないこと）
--      args         = p_list_id uuid, p_muni_code_5 text, p_school_district_id uuid,
--                     p_property_type text, p_price_min integer, p_price_max integer
--    期待行数: 3（3本がすべて存在すること＝適用漏れの検知）
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,
  p.prosecdef,
  p.provolatile,
  p.proconfig,
  pg_get_function_result(p.oid) AS result_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_buyer_match_summary', 'get_buyer_match_cells', 'get_buyer_match_rows')
ORDER BY p.proname;


-- ── ② proacl(ACL) の確認 ─────────────────────────────────────────────
--    期待: authenticated=X(EXECUTE) のみ（＋関数所有者）。
--      ⛔ service_role が現れないこと（O109: 新規 public 関数へ service_role の EXECUTE が
--         自動付与されるのを migration 側の REVOKE で剥がした。現れたら O109 の再発）。
--      ⛔ anon が現れないこと・PUBLIC(=先頭 "=X") が無いこと。
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,
  p.proacl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_buyer_match_summary', 'get_buyer_match_cells', 'get_buyer_match_rows')
ORDER BY p.proname;


-- ── ②' ACL を 1行=1grantee に展開した機械的確認 ──────────────────────
--    期待: grantee は 'authenticated' のみ（＋関数所有者）。
--      ⛔ 'service_role' / 'anon' / 'public' が 1 行も現れないこと。
SELECT
  p.proname,
  (aclexplode(p.proacl)).grantee::regrole AS grantee,
  (aclexplode(p.proacl)).privilege_type   AS privilege
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_buyer_match_summary', 'get_buyer_match_cells', 'get_buyer_match_rows')
ORDER BY p.proname, grantee;


-- ── ③ 返り値の列構成の確認 ────────────────────────────────────────────
--    期待:
--      get_buyer_match_summary … jsonb（スカラ返し。TABLE ではない）
--      get_buyer_match_cells   … property_type, label_ja, price_bucket_min, price_bucket_max,
--                                floor_area_bucket_min, floor_area_bucket_max, n の 7 列
--        ⛔ distinct_rows が無いこと（裁定19: 総数は summary の wide/near を使う）
--        ⛔ 生件数を意味する列が n（k 抑止後）以外に無いこと
--      get_buyer_match_rows    … row_id, external_id, customer_name, assignee, property_types,
--                                price_min, price_max, desired_floor_area_min,
--                                desired_floor_area_max, inquiry_at, match_method の 11 列
SELECT
  p.proname,
  pg_get_function_result(p.oid) AS result_columns
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_buyer_match_summary', 'get_buyer_match_cells', 'get_buyer_match_rows')
ORDER BY p.proname;


-- ── ④ 関数本体の不変条件（ソース文字列での機械チェック）────────────────
--    ⚠ 期待値は関数ごとに違う（get_buyer_match_rows は k 抑止をかけないため
--       has_k_const / uses_count_distinct は false が正しい）。
--
--      列                  summary  cells  rows   意味
--      has_k_const         true     true   false  k=5 が k_const の1箇所にある（裁定20）
--      no_bare_five        true     true   true   HAVING/CASE に 5 が直書きされていない
--      has_12_months       true     true   true   直近12ヶ月の期間制限がある（裁定16）
--      has_lead_type_buy   true     true   true   lead_type='buy' に限定している
--      has_deleted_at      true     true   true   deleted_at IS NULL の現存条件がある
--      has_plan_guard      true     true   true   current_user_plan()='platinum' の多層防御
--      has_org_guard       true     true   true   organization_id ∈ current_user_org_ids()
--      has_match_method    true     true   true   校区突合が name_exact/name_normalized のみ
--      one_coalesce_expr   true     true   true   裁定17 の COALESCE 3段が関数内に1箇所だけ
--      uses_count_distinct true     true   false  count(DISTINCT ...) を使う（裁定19）
--
--    ⛔ summary / cells の has_k_const・no_bare_five・uses_count_distinct が false に
--       なったら k 匿名化の実装が崩れている。3本の has_plan_guard / has_org_guard が
--       1つでも false なら多層防御の欠落＝適用しないこと。
SELECT
  p.proname,
  p.prosrc LIKE '%k_const AS (%'                                   AS has_k_const,
  p.prosrc NOT LIKE '%>= 5%' AND p.prosrc NOT LIKE '%< 5%'          AS no_bare_five,
  p.prosrc LIKE '%interval ''12 months''%'                          AS has_12_months,
  p.prosrc LIKE '%r.lead_type = ''buy''%'                           AS has_lead_type_buy,
  p.prosrc LIKE '%r.deleted_at IS NULL%'                            AS has_deleted_at,
  p.prosrc LIKE '%current_user_plan() = ''platinum''%'              AS has_plan_guard,
  p.prosrc LIKE '%current_user_org_ids()%'                          AS has_org_guard,
  p.prosrc LIKE '%''name_exact'', ''name_normalized''%'             AS has_match_method,
  (length(p.prosrc) - length(replace(p.prosrc, 'COALESCE(b.desired_muni_code_5', ''))) 
    / length('COALESCE(b.desired_muni_code_5') = 1                  AS one_coalesce_expr,
  p.prosrc LIKE '%count(DISTINCT%'                                  AS uses_count_distinct
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_buyer_match_summary', 'get_buyer_match_cells', 'get_buyer_match_rows')
ORDER BY p.proname;


-- =====================================================================
-- ⑤〜⑨ 実データでの呼び出し。⛔ 個票（⑨）の結果は外部に貼らない（D144）。
--   ★事前に :list_id / :muni_code_5 / :school_district_id / :property_type を差し替える。
--     psql なら \set、Supabase コネクタなら下記の値を直接書き換えて実行する。
--   ★実行は Platinum の authenticated ロールで行うこと（service_role では
--     current_user_plan() が 'free' 相当になり、すべて 0 件になるのが正しい挙動）。
-- =====================================================================

-- ── ⑤ 対象母数の素の把握（k 抑止と突き合わせるための分母）──────────────
--    期待: buy_rows は「直近12ヶ月・現存・lead_type=buy」の件数。
--          desired_muni_code_5 は現時点で全 NULL（裁定17 の前提・PR-D で埋まる）。
SELECT
  count(*)                                                   AS buy_rows_12m,
  count(*) FILTER (WHERE r.desired_muni_code_5 IS NOT NULL)  AS has_desired_muni_code_5,
  count(*) FILTER (WHERE r.desired_floor_area_min IS NOT NULL
                      OR r.desired_floor_area_max IS NOT NULL) AS has_floor_area
FROM public.customer_list_rows r
WHERE r.list_id = '00000000-0000-0000-0000-000000000000'::uuid   -- ★差し替え
  AND r.deleted_at IS NULL
  AND r.lead_type = 'buy'
  AND r.inquiry_at IS NOT NULL
  AND r.inquiry_at >= now() - interval '12 months';


-- ── ⑥ R1: 通常呼び出し ────────────────────────────────────────────────
--    期待: jsonb に wide_count / near_count / suppressed_wide / suppressed_near
--          / k / unknown_area_count の 6 キー。k = 5。
--          near_count <= wide_count（校区は市区町村の部分集合）。
--          ⛔ wide_count / near_count が 1〜4 の値になっていないこと（k 抑止の確認）。
SELECT public.get_buyer_match_summary(
  '00000000-0000-0000-0000-000000000000'::uuid,   -- ★p_list_id
  '35208',                                        -- ★p_muni_code_5（5桁）
  NULL::uuid,                                     -- ★p_school_district_id（NULL=市区町村スコープ）
  'used_condo',                                   -- ★p_property_type
  2000,                                           -- ★p_price_min（万円）
  3500                                            -- ★p_price_max（万円）
) AS summary;


-- ── ⑦ R1: k 抑止が効くことの確認（該当が必ず 5 未満になる条件で呼ぶ）──────
--    期待: wide_count = 0 AND suppressed_wide = true
--          （存在しない市区町村コードを渡す＝母数 0。0 も「5 未満」なので suppressed=true）。
--    ⛔ 1〜4 の実数が返ってきたら k 抑止の実装ミス。
SELECT public.get_buyer_match_summary(
  '00000000-0000-0000-0000-000000000000'::uuid,   -- ★p_list_id
  '99999',                                        -- 存在しない市区町村コード
  NULL::uuid,
  'used_condo',
  2000,
  3500
) AS summary_suppressed;


-- ── ⑦' R1: 価格の重なり（裁定13/18）の確認 ────────────────────────────
--    期待: 売主レンジを両側 NULL にすると「価格の希望なし」扱いで near_count が
--          最大になる（＝価格で1件も落ちない）。上の ⑥ の near_count 以上になること。
SELECT public.get_buyer_match_summary(
  '00000000-0000-0000-0000-000000000000'::uuid,   -- ★p_list_id
  '35208',                                        -- ★p_muni_code_5
  NULL::uuid,
  'used_condo',
  NULL::integer,                                  -- 売主レンジ下限なし
  NULL::integer                                   -- 売主レンジ上限なし
) AS summary_price_open;


-- ── ⑧ R2: セル集計 ───────────────────────────────────────────────────
--    期待: 返る行はすべて n >= 5（⛔ 1〜4 のセルが 1 行も無いこと）。
--          price_bucket_min/max は 500 刻み（max - min = 500）。ただし
--          「価格の希望なし」枠は price_bucket_min/max とも NULL。
--          floor_area_bucket_min/max は 20 刻み。面積 NULL の行は両方 NULL の枠に入る。
--          ⛔ セルの n を合算しても総人数にはならない（1行が複数の価格バケットに現れる）。
SELECT *
FROM public.get_buyer_match_cells(
  '00000000-0000-0000-0000-000000000000'::uuid,   -- ★p_list_id
  '35208',                                        -- ★p_muni_code_5
  NULL::uuid,                                     -- ★p_school_district_id
  NULL::text,                                     -- p_property_type NULL = 全種別
  NULL::integer,                                  -- 未使用
  NULL::integer                                   -- 未使用
);

-- ⑧' セルの不変条件を機械的に確認する（上と同じ引数で呼ぶこと）。
--    期待: min_n >= 5 / bad_price_step = 0 / bad_area_step = 0。
SELECT
  count(*)                                                          AS cells,
  min(c.n)                                                          AS min_n,          -- 期待 >= 5
  count(*) FILTER (WHERE c.price_bucket_min IS NOT NULL
                     AND c.price_bucket_max - c.price_bucket_min <> 500)  AS bad_price_step,
  count(*) FILTER (WHERE c.floor_area_bucket_min IS NOT NULL
                     AND c.floor_area_bucket_max - c.floor_area_bucket_min <> 20) AS bad_area_step,
  count(*) FILTER (WHERE (c.price_bucket_min IS NULL) <> (c.price_bucket_max IS NULL))  AS bad_price_null_pair,
  count(*) FILTER (WHERE (c.floor_area_bucket_min IS NULL) <> (c.floor_area_bucket_max IS NULL)) AS bad_area_null_pair
FROM public.get_buyer_match_cells(
  '00000000-0000-0000-0000-000000000000'::uuid,   -- ★p_list_id
  '35208',                                        -- ★p_muni_code_5
  NULL::uuid,
  NULL::text,
  NULL::integer,
  NULL::integer
) AS c;


-- ── ⑨ R3: 社内個票 ───────────────────────────────────────────────────
-- ⛔⛔ この結果は社内画面専用。売主への提示・PDF への出力を禁止する。
--     完了報告・コミットメッセージ・チャットに貼らないこと（D144: 集計値のみ可）。
--     ここでは件数と並び順の確認だけを行い、行の中身は目視にとどめる。
--    期待: 件数は ⑥ の near_count と一致する（k 抑止をかけないため、near_count が
--          抑止で 0 になっている場合は「⑨ の件数 < 5 かつ ⑥ が 0」となるのが正しい）。
--          並びは inquiry_at DESC NULLS LAST, external_id。
SELECT count(*) AS rows_for_internal_view
FROM public.get_buyer_match_rows(
  '00000000-0000-0000-0000-000000000000'::uuid,   -- ★p_list_id
  '35208',                                        -- ★p_muni_code_5
  NULL::uuid,                                     -- ★p_school_district_id
  'used_condo',                                   -- ★p_property_type
  2000,                                           -- ★p_price_min
  3500                                            -- ★p_price_max
);

-- ⑨' 返り列に PII が増えていないことの確認（CL-32）。
--    期待: 列は row_id / external_id / customer_name / assignee / property_types /
--          price_min / price_max / desired_floor_area_min / desired_floor_area_max /
--          inquiry_at / match_method の 11 列のみ。
--    ⛔ phone / furigana / email / birth 等の語を含む列が 1 つも無いこと。
SELECT pg_get_function_result(p.oid) AS result_columns
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_buyer_match_rows';


-- =====================================================================
-- ⑩ 権限の実地確認（任意・別セッションで anon / service_role として実行）
--    期待:
--      anon         … 3本とも ERROR: permission denied for function ...
--      service_role … 3本とも ERROR: permission denied for function ...（O109）
--      authenticated(Platinum)   … 正常に返る
--      authenticated(Platinum 以外) … エラーにはならず 0 件 / wide=near=0 になる
--        （多層防御 current_user_plan()='platinum' が WHERE で効くため）
-- =====================================================================

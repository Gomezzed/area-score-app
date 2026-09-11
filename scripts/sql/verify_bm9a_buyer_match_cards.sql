-- =====================================================================
-- scripts/sql/verify_bm9a_buyer_match_cards.sql
-- PR-BM-9a / Tier1: 匿名カード RPC ＋ organizations オプトイン列の適用後 検証。
--   対象: public.organizations.buyer_match_cards_opt_in（列）
--         public.get_buyer_match_cards(uuid, text, uuid, text, integer, integer)（関数）
--   （migration: supabase/migrations/20260911000100_bm9a_buyer_match_cards.sql）
--
-- SELECT のみ / DDL・DML は書かない。BEGIN/COMMIT・INSERT・UPDATE は含めない。
--
-- ⚠ 適用は PM。migration を Supabase コネクタで適用したうえで、台帳
--    supabase_migrations.schema_migrations への INSERT を忘れないこと（版番号 20260911000100）。
--    ①〜⑤ は関数を呼ばない（宣言と権限だけを確認する）。⑥以降は実データで呼ぶ。
--    ⛔ カードの中身（希望予算・面積・校区）は完了報告・コミット・チャットに貼らない。
--       構造と件数のみを確認する（D144: 集計値のみ可）。
--    ⚠ 構文パースは PM が pglast で行う（★1 の恒久対応）。
--
-- ★シグネチャは (uuid, text, uuid, text, integer, integer)。
-- =====================================================================


-- ── ① organizations.buyer_match_cards_opt_in の列定義 ─────────────────
--    期待: data_type=boolean / is_nullable='NO' / column_default='false'
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'organizations'
  AND column_name  = 'buyer_match_cards_opt_in';

-- ①' 全行 false であること（適用直後・裁定44）。
--    期待: total_orgs = opt_in_false、opt_in_true = 0。
SELECT
  count(*)                                              AS total_orgs,
  count(*) FILTER (WHERE buyer_match_cards_opt_in IS FALSE) AS opt_in_false,
  count(*) FILTER (WHERE buyer_match_cards_opt_in IS TRUE)  AS opt_in_true,
  count(*) FILTER (WHERE buyer_match_cards_opt_in IS NULL)  AS opt_in_null   -- 期待 0（NOT NULL）
FROM public.organizations;


-- ── ② organizations の GRANT / policy が不変であること（裁定44）─────────
--    ⛔ 本 PR は organizations の GRANT・policy を一切変更していない。
--    期待(GRANT): grantee='authenticated' かつ privilege_type='SELECT' の1行のみ。
--      ⛔ authenticated に INSERT/UPDATE/DELETE が無いこと。anon が1行も無いこと。
SELECT
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name   = 'organizations'
ORDER BY grantee, privilege_type;

-- ②' policy が org_select_member(SELECT) の1本のみで不変であること。
--    期待: policy_count = 1、policyname='org_select_member'、cmd='SELECT'。
SELECT
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'organizations'
ORDER BY policyname;

SELECT count(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'organizations';   -- 期待: 1

-- ②'' RLS が有効なままであること。
--    期待: relrowsecurity = true。
SELECT relname, relrowsecurity
FROM pg_class
WHERE oid = 'public.organizations'::regclass;


-- ── ③ get_buyer_match_cards の宣言（prosecdef / provolatile / proconfig / args）──
--    期待:
--      prosecdef      = false   (SECURITY INVOKER)
--      provolatile    = 'v'     (VOLATILE ★裁定45・本関数だけ 'v')
--      proconfig      = {"search_path=public, pg_temp"}（extensions を含まないこと）
--      args           = p_list_id uuid, p_muni_code_5 text, p_school_district_id uuid,
--                       p_property_type text, p_price_min integer, p_price_max integer
--      result_type    = jsonb
--      overload_count = 1（オーバーロードが1本だけ＝重複定義していない）
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,
  p.prosecdef,
  p.provolatile,
  p.proconfig,
  pg_get_function_result(p.oid)             AS result_type,
  count(*) OVER ()                          AS overload_count
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_buyer_match_cards';


-- ── ④ proacl(ACL) の確認 ─────────────────────────────────────────────
--    期待: authenticated=X(EXECUTE) のみ（＋関数所有者）。
--      ⛔ service_role が現れないこと（O109: 新規 public 関数へ service_role の EXECUTE が
--         自動付与されるのを migration 側の REVOKE で剥がした。現れたら O109 の再発）。
--      ⛔ anon が現れないこと・PUBLIC(=先頭 "=X") が無いこと。
SELECT
  p.proname,
  p.proacl,
  p.proacl IS NULL AS acl_is_null   -- ⚠ true なら「デフォルト権限(PUBLIC 実行可)」の疑い＝警告。
                                    --    REVOKE/GRANT が効いていれば proacl は非 NULL になる。
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_buyer_match_cards';

-- ④' ACL を 1行=1grantee に展開した機械的確認。
--    期待: grantee は 'authenticated' のみ（＋関数所有者）。
--      ⛔ 'service_role' / 'anon' / 'public' が 1 行も現れないこと。
SELECT
  p.proname,
  (aclexplode(p.proacl)).grantee::regrole AS grantee,
  (aclexplode(p.proacl)).privilege_type   AS privilege
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_buyer_match_cards'
ORDER BY grantee;


-- ── ⑤ 本文の不変条件（ソース文字列・目視／半機械チェック）──────────────
--    ⑤-A 禁止列が jsonb_build_object のキー（'…', の形）として現れないことを目視する。
--        ⛔ 次の語がカードのキーに使われていないこと（裁定47・「型で防ぐ」）:
--           'row_id' / 'list_id' / 'user_id' / 'organization_id' / 'external_id' /
--           'customer_name' / 'assignee' / 'inquiry_at' / 'media' / 'category' /
--           'address_raw' / 'address_normalized' / 'desired_school' / 'input_name' /
--           'normalized_name' / 'match_method' / 'candidate_count'
--        ※ 列名やエイリアス（例: r.inquiry_at, AS row_id）としての出現は問題ない。
--          あくまで jsonb_build_object の '…', の位置に無いことを見る（機械判定は不要）。
--        カードの正しいキーは次の8つのみ:
--           property_types / price_min / price_max /
--           desired_floor_area_min / desired_floor_area_max /
--           desired_land_area_min / desired_land_area_max / desired_districts
SELECT pg_get_functiondef(p.oid) AS function_source
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_buyer_match_cards';

-- ⑤-B 本文の半機械チェック（prosrc の LIKE）。
--    期待（すべて true）:
--      has_k_const        k_const AS (…) がある（裁定49）
--      has_price_widen    price_widen 定数が k_const にある（裁定49）
--      has_max_cards      max_cards 定数が k_const にある（裁定49）
--      no_bare_compare    比較式に 5 / 500 を直書きしていない（k は kc.k・拡張は kc.price_widen 経由）
--      has_12_months      直近12ヶ月の期間制限（裁定16）
--      has_lead_type_buy  lead_type='buy' に限定
--      has_deleted_at     deleted_at IS NULL の現存条件
--      has_plan_guard     current_user_plan()='platinum' の多層防御
--      has_org_guard      organization_id ∈ current_user_org_ids()
--      has_optin_exists   母数側 per-row EXISTS(organizations … opt_in)（裁定51b）
--      has_match_method   校区突合が name_exact/name_normalized のみ
--      one_coalesce_expr  裁定17 の COALESCE 3段が本文に1箇所だけ
--      has_greatest_case  段2の GREATEST を CASE で NULL 保護している（裁定52）
--      has_random_limit   ORDER BY random() ＋ LIMIT (max_cards) がある（裁定53）
SELECT
  p.prosrc LIKE '%k_const AS (%'                                    AS has_k_const,
  p.prosrc LIKE '%price_widen%'                                     AS has_price_widen,
  p.prosrc LIKE '%max_cards%'                                       AS has_max_cards,
  (p.prosrc NOT LIKE '%>= 5%' AND p.prosrc NOT LIKE '%- 500%')      AS no_bare_compare,
  p.prosrc LIKE '%interval ''12 months''%'                          AS has_12_months,
  p.prosrc LIKE '%r.lead_type = ''buy''%'                           AS has_lead_type_buy,
  p.prosrc LIKE '%r.deleted_at IS NULL%'                            AS has_deleted_at,
  p.prosrc LIKE '%current_user_plan() = ''platinum''%'              AS has_plan_guard,
  p.prosrc LIKE '%current_user_org_ids()%'                          AS has_org_guard,
  p.prosrc LIKE '%buyer_match_cards_opt_in%'                        AS has_optin_exists,
  p.prosrc LIKE '%''name_exact'', ''name_normalized''%'             AS has_match_method,
  (length(p.prosrc) - length(replace(p.prosrc, 'COALESCE(b.desired_muni_code_5', '')))
    / length('COALESCE(b.desired_muni_code_5') = 1                  AS one_coalesce_expr,
  p.prosrc LIKE '%GREATEST(p_price_min - kc.price_widen, 0)%'       AS has_greatest_case,
  (p.prosrc LIKE '%ORDER BY random()%' AND p.prosrc LIKE '%LIMIT (SELECT max_cards FROM k_const)%')
                                                                    AS has_random_limit
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_buyer_match_cards';


-- =====================================================================
-- ⑥〜⑨ 実データでの呼び出し。⛔ カードの中身は外部に貼らない（D144）。
--   ★事前に :list_id / :muni_code_5 / :property_type を差し替える。
--   ★実行は Platinum の authenticated ロールで行うこと（service_role では
--     current_user_plan() が platinum でなくなり、母数 0＝固定形になるのが正しい挙動）。
--   ★カードが返るのは当該 org が buyer_match_cards_opt_in=true のときだけ。
--     検証前に PM が対象 org のフラグを ON にしておくこと（OFF のままなら opt_in=false の固定形）。
-- =====================================================================

-- ── ⑥ opt_in=false（既定）の固定形 ────────────────────────────────────
--    フラグ OFF の org のリストで呼ぶ、または存在しない list_id で呼ぶ。
--    期待: opt_in=false / stage=null / used_conditions=null / matched_count=0 /
--          suppressed=false / cards=[]（裁定51c/51d）。⛔ 段の途中経過を出さない。
SELECT public.get_buyer_match_cards(
  '00000000-0000-0000-0000-000000000000'::uuid,   -- ★存在しない or OFF の list_id
  '23202',
  NULL::uuid,
  'used_detached',
  1500,
  2500
) AS cards_optin_false;

-- ── ⑦ opt_in=true・通常呼び出し（キーと k・段の確認）──────────────────
--    ★対象 org のフラグを ON にしたうえで、その org の list_id で呼ぶ。
--    期待: 返り jsonb のトップレベルキーは opt_in / k / max_cards / stage / used_conditions /
--          matched_count / suppressed / cards の8つ。k=5・max_cards=6。
--          stage が非 null なら matched_count >= 5（⛔ 1〜4 が返らないこと）。
--          cards は配列で 0〜6件。⛔ 中身は目視のみ・貼らない。
SELECT
  (c ->> 'opt_in')::boolean          AS opt_in,
  (c ->> 'k')::int                   AS k,             -- 期待 5
  (c ->> 'max_cards')::int           AS max_cards,     -- 期待 6
  (c ->> 'stage')                    AS stage,         -- 1〜4 または null
  (c ->> 'matched_count')::int       AS matched_count, -- 期待 >=5 または 0
  (c ->> 'suppressed')::boolean      AS suppressed,
  jsonb_array_length(c -> 'cards')   AS card_count,    -- 期待 0〜6
  (SELECT bool_and(key IN (
      'opt_in','k','max_cards','stage','used_conditions','matched_count','suppressed','cards'))
   FROM jsonb_object_keys(c) AS key) AS keys_ok        -- 期待 true（余計なトップレベルキーが無い）
FROM (
  SELECT public.get_buyer_match_cards(
    '00000000-0000-0000-0000-000000000000'::uuid,   -- ★ON の org の list_id
    '23202',                                        -- ★p_muni_code_5（5桁）
    NULL::uuid,                                     -- p_school_district_id（BM-7 は NULL）
    'used_detached',                                -- ★p_property_type
    1500,                                           -- ★p_price_min（万円）
    2500                                            -- ★p_price_max（万円）
  ) AS c
) t;

-- ── ⑧ カード1枚のキーが8列に限定され、禁止列が無いこと（裁定47）────────────
--    期待: 各カードのキー集合が下記8つの部分集合（余計なキーが無い）。
--          bad_key_cards = 0。card_count >= 1 のとき有効な確認（0 件なら別 org で再確認）。
--    ⛔ カードの値は SELECT しない（キー名だけを確認する）。
SELECT
  count(*)                                                          AS card_count,
  count(*) FILTER (WHERE NOT (
    (SELECT bool_and(k IN (
       'property_types','price_min','price_max',
       'desired_floor_area_min','desired_floor_area_max',
       'desired_land_area_min','desired_land_area_max','desired_districts'))
     FROM jsonb_object_keys(card) AS k)
  ))                                                                AS bad_key_cards   -- 期待 0
FROM (
  SELECT jsonb_array_elements(
    public.get_buyer_match_cards(
      '00000000-0000-0000-0000-000000000000'::uuid,   -- ★ON の org の list_id
      '23202',
      NULL::uuid,
      'used_detached',
      1500,
      2500
    ) -> 'cards'
  ) AS card
) c;

-- ── ⑨ 段の降格と used_conditions の整合（任意・目視）──────────────────
--    価格レンジを段階的に広げ／外して呼び、stage と used_conditions が
--    裁定41/48 のとおり動くことを確認する（段2 は widened、段3以降は価格 null、段4 は種別 null）。
--    ⛔ ここでも cards の中身は貼らない。stage / used_conditions のみ確認する。


-- =====================================================================
-- ⑩ 権限の実地確認（任意・別セッションで anon / service_role として実行）
--    期待:
--      anon         … ERROR: permission denied for function get_buyer_match_cards
--      service_role … ERROR: permission denied for function get_buyer_match_cards（O109）
--      authenticated(Platinum・ON org)      … 正常に返る
--      authenticated(Platinum 以外 or OFF)  … エラーにならず opt_in=false 相当 / 母数 0 の固定形
-- =====================================================================

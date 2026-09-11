-- =====================================================================
-- 20260912000100_bm10a_buyer_match_org_scope.sql
-- PR-BM-10a / Tier1: 購入希望マッチ RPC の org スコープ対応（migration 作成のみ）。
--   決定: 2026-09-12 PM 裁定-bm-A（BM-10a セッション）。方針＝案イ。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う（R7・D57）。
--   ※ supabase db push は恒久禁止。適用後は台帳
--     supabase_migrations.schema_migrations への INSERT を忘れないこと（本 PR 版番号=20260912000100）。
--
-- 【本 PR で作るもの】既存3関数を CREATE OR REPLACE で置換する（新関数は作らない・
--   シグネチャは1ビットも変えない・DROP FUNCTION は使わない）。
--   (1) public.get_buyer_match_summary(uuid,text,uuid,text,integer,integer)   … c1
--   (2) public.get_buyer_match_cards(uuid,text,uuid,text,integer,integer)     … c1
--   (3) public.get_customer_list_areas(uuid,text)                             … c2
--
-- 【変更の要旨（案イ・裁定-bm-A）】名簿1件(list_id)単位を「呼び出し者が RLS で見える
--   すべての名簿を合算する org スコープ」へ広げる。本文の list_id 絞りを
--   (p_list_id IS NULL OR …) にするだけで、RLS(cl_select_org / clr_select_org が
--   organization_id IN (SELECT public.current_user_org_ids()) で効く)により
--   「呼び出し者が見える全名簿」になる。p_list_id が非 NULL のときは従来と一字一句同じ。
--
-- 【変更した WHERE 句（before/after・機械照合用）】
--   (1) summary buy_rows:
--         before: WHERE r.list_id = p_list_id
--         after : WHERE (p_list_id IS NULL OR r.list_id = p_list_id)
--   (2) cards buy_rows:
--         before: WHERE r.list_id = p_list_id
--         after : WHERE (p_list_id IS NULL OR r.list_id = p_list_id)
--       cards opt(scalar opt_in): p_list_id IS NULL のとき org_optin(見える org のいずれか1つ
--         が ON なら true)へ分岐。非 NULL のときは従来の list_org のまま（裁定-bm-A）。
--         ⛔ 母数側の per-row EXISTS(organizations … buyer_match_cards_opt_in) は削除しない（裁定51b）。
--   (3) areas:
--         before: WHERE l.id = p_list_id
--         after : WHERE (p_list_id IS NULL OR l.id = p_list_id)
--       ⚠ 本関数は索引であって集計ではない（COUNT/n を返さず k 抑止を持たない・SD-45）。
--         org スコープ化でもこの性質は不変（抑止ロジックは存在しないため触れない）。
--
-- 【触っていないもの（同一ソースにあるが本 PR では再掲しない）】
--   public.get_buyer_match_cells / public.get_buyer_match_rows（20260909000300 の 258/460 行）。
--   organizations / customer_lists / customer_list_rows の RLS・policy・GRANT。
-- =====================================================================

BEGIN;

-- =====================================================================
-- (1) get_buyer_match_summary — org スコープ対応（buy_rows の list_id 絞りのみ変更）
--   ★本文は 20260909000300_bm4_buyer_match_rpcs.sql 80-216 行の逐語コピー。
--     差分は buy_rows の WHERE 1行（104 行）と COMMENT の追記のみ。
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_buyer_match_summary(
  p_list_id            uuid,
  p_muni_code_5        text,
  p_school_district_id uuid,
  p_property_type      text,
  p_price_min          integer,
  p_price_max          integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  -- 裁定20: k はここ1箇所。以降は (SELECT k FROM k_const) で参照する。
  WITH k_const AS (
    SELECT 5 AS k
  ),
  -- 対象の買い行（現存条件＋直近12ヶ月＋多層防御）。
  buy_rows AS (
    SELECT
      r.id                  AS row_id,
      r.desired_muni_code_5 AS desired_muni_code_5
    FROM public.customer_list_rows r
    -- BM-10a(裁定-bm-A): p_list_id IS NULL=見える全名簿を合算（org スコープ）。非 NULL は従来同一。
    WHERE (p_list_id IS NULL OR r.list_id = p_list_id)
      AND r.deleted_at IS NULL
      AND r.lead_type = 'buy'
      -- 裁定16: 直近12ヶ月（売主向けの文言に合わせる）。
      AND r.inquiry_at IS NOT NULL
      AND r.inquiry_at >= now() - interval '12 months'
      AND public.current_user_plan() = 'platinum'
      AND r.organization_id IN (SELECT public.current_user_org_ids())
  ),
  -- 裁定17: 希望市区町村の COALESCE 3段。★この式は本関数内でここ1箇所だけ★
  row_area AS (
    SELECT
      b.row_id                AS row_id,
      dd.school_district_id   AS school_district_id,
      dd.match_method         AS match_method,
      COALESCE(b.desired_muni_code_5, dd.muni_code_5, sd.muni_code_5) AS muni_code_5
    FROM buy_rows b
    JOIN public.customer_list_row_desired_districts dd
      ON dd.row_id = b.row_id
    LEFT JOIN public.school_districts sd
      ON sd.id = dd.school_district_id
     AND sd.is_public IS TRUE
  ),
  -- 行ごとに「希望エリアが1つでも解決したか」を判定する（裁定17）。
  area_known AS (
    SELECT ra.row_id, bool_or(ra.muni_code_5 IS NOT NULL) AS has_area
    FROM row_area ra
    GROUP BY ra.row_id
  ),
  -- 市区町村スコープ（p_muni_code_5 IS NULL なら全件・BM-3 と同じ規約）。
  --   希望エリア不明の行はここで落ちる（裁定17）。
  scoped AS (
    SELECT DISTINCT ra.row_id
    FROM row_area ra
    JOIN area_known ak ON ak.row_id = ra.row_id
    WHERE ak.has_area
      AND (p_muni_code_5 IS NULL OR ra.muni_code_5 = p_muni_code_5)
  ),
  -- 校区スコープ（near 用）。確定一致(name_exact/name_normalized)のみ。
  --   p_school_district_id IS NULL のときは市区町村スコープと同じ集合になる。
  near_scoped AS (
    SELECT DISTINCT ra.row_id
    FROM row_area ra
    JOIN scoped s ON s.row_id = ra.row_id
    WHERE p_school_district_id IS NULL
       OR (ra.school_district_id = p_school_district_id
           AND ra.match_method IN ('name_exact', 'name_normalized'))
  ),
  -- wide: 同じ市区町村で同じ物件種別を探している人数（校区は問わない・価格も見ない）。
  wide_agg AS (
    SELECT count(DISTINCT s.row_id)::integer AS n
    FROM scoped s
    JOIN public.customer_list_row_property_types pt
      ON pt.row_id = s.row_id
    WHERE p_property_type IS NULL OR pt.property_type = p_property_type
  ),
  -- near: 同じ校区＋同じ種別＋価格が重なる人数。
  near_agg AS (
    SELECT count(DISTINCT ns.row_id)::integer AS n
    FROM near_scoped ns
    JOIN public.customer_list_row_property_types pt
      ON pt.row_id = ns.row_id
    WHERE (p_property_type IS NULL OR pt.property_type = p_property_type)
      -- 裁定13/18: 価格の重なり。開区間・NULL は無制限。両側 NULL は該当扱い。
      AND (pt.price_min IS NULL OR p_price_max IS NULL OR pt.price_min <= p_price_max)
      AND (pt.price_max IS NULL OR p_price_min IS NULL OR pt.price_max >= p_price_min)
  ),
  -- unknown_area: 希望エリアが1つも解決しなかった行（裁定17・k 抑止の対象外）。
  --   area_known は LEFT JOIN で受ける＝希望校区の行が1本も無い買い行もここに入る。
  unknown_area AS (
    SELECT count(DISTINCT b.row_id)::integer AS n
    FROM buy_rows b
    LEFT JOIN area_known ak ON ak.row_id = b.row_id
    JOIN public.customer_list_row_property_types pt
      ON pt.row_id = b.row_id
    WHERE NOT COALESCE(ak.has_area, false)
      AND (p_property_type IS NULL OR pt.property_type = p_property_type)
  )
  -- 裁定15: k 未満は 0 を返し suppressed_* を true にする。⛔ 5 未満の実数は返さない。
  SELECT jsonb_build_object(
    'wide_count',         CASE WHEN w.n  >= (SELECT k FROM k_const) THEN w.n  ELSE 0 END,
    'near_count',         CASE WHEN nr.n >= (SELECT k FROM k_const) THEN nr.n ELSE 0 END,
    'suppressed_wide',    w.n  < (SELECT k FROM k_const),
    'suppressed_near',    nr.n < (SELECT k FROM k_const),
    'k',                  (SELECT k FROM k_const),
    'unknown_area_count', ua.n
  )
  FROM wide_agg w, near_agg nr, unknown_area ua;
$$;

COMMENT ON FUNCTION public.get_buyer_match_summary(uuid, text, uuid, text, integer, integer) IS
  'PR-BM-4: 売主の物件条件に対し、当該 org の買い希望(lead_type=''buy'')を2つの数で返す。'
  '返り値 jsonb: wide_count(同じ市区町村で同じ物件種別を探している人数・校区は問わず価格も見ない) / '
  'near_count(同じ校区＋同じ種別＋価格が重なる人数) / suppressed_wide / suppressed_near / k / unknown_area_count。'
  '裁定15の k 匿名化: k=5 未満は 0 を返し suppressed_* を true にする(⛔5未満の実数は返さない)。k は関数内の k_const 1箇所。'
  '裁定13/18の価格重なり: 売主・買主の双方を開区間として扱い NULL は無制限、両側 NULL は「価格の希望なし」として該当に含める。'
  '裁定14: 広さは条件に使わない(面積を持つ行が少なく絞ると母数が消えるため)。'
  '裁定16: 直近12ヶ月(inquiry_at IS NOT NULL AND >= now()-12 months)。裁定17: 希望市区町村は '
  'COALESCE(customer_list_rows.desired_muni_code_5, customer_list_row_desired_districts.muni_code_5, school_districts.muni_code_5) '
  'の優先順で決め、3つとも NULL の行は母数に含めず unknown_area_count(k 抑止の対象外・充足率の観測用)で返す。'
  '校区の突合は match_method IN (name_exact, name_normalized) のみ。物件種別は is_primary を問わない。'
  '引数 NULL の扱い(BM-3 の p_muni_code_5 と同じ規約): p_muni_code_5 IS NULL=全市区町村 / '
  'p_school_district_id IS NULL=校区で絞らない(near は市区町村スコープ＋価格重なりになる) / p_property_type IS NULL=全種別。'
  'SECURITY INVOKER で RLS(org スコープ)が効くうえ、service_role の RLS バイパスに備え '
  'current_user_plan()=platinum・organization_id∈current_user_org_ids()・school_districts.is_public を関数側でも明示。'
  'BM-10a(裁定-bm-A): p_list_id IS NULL=呼び出し者が RLS で見えるすべての名簿を合算する(org スコープ)。'
  'p_list_id が非 NULL のときの挙動は従来と一字一句同じである。';

-- deny-by-default: PUBLIC/anon から実行権を剥奪し、authenticated のみに付与。
-- (新規 public RPC は anon にも自動で EXECUTE が付くため anon を明示的に REVOKE する)
REVOKE ALL ON FUNCTION public.get_buyer_match_summary(uuid, text, uuid, text, integer, integer) FROM PUBLIC, anon;
-- ★O109: Supabase の ALTER DEFAULT PRIVILEGES が新規 public 関数へ service_role の
--   EXECUTE を自動付与するため、明示的に剥がす(PUBLIC/anon の REVOKE では剥がれない・#74 と同理由)。
REVOKE ALL ON FUNCTION public.get_buyer_match_summary(uuid, text, uuid, text, integer, integer) FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_buyer_match_summary(uuid, text, uuid, text, integer, integer) TO authenticated;


-- =====================================================================
-- (2) get_buyer_match_cards — org スコープ対応（buy_rows の list_id 絞り＋scalar opt_in の分岐）
--   ★本文は 20260911000100_bm9a_buyer_match_cards.sql 85-365 行の逐語コピー。
--     差分は buy_rows の WHERE 1行（129 行）／org_optin CTE の追加＋opt CTE の CASE 化
--     （list_org 114-119 行は不変）／COMMENT の追記のみ。
--   ⛔ 母数側の per-row EXISTS(organizations … buyer_match_cards_opt_in) は削除しない（裁定51b）。
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_buyer_match_cards(
  p_list_id            uuid,
  p_muni_code_5        text,
  p_school_district_id uuid,
  p_property_type      text,
  p_price_min          integer,
  p_price_max          integer
)
RETURNS jsonb
LANGUAGE sql
VOLATILE                                   -- ★裁定45: random() を使うため VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  -- 裁定49: 定数はここ1箇所。以降は (SELECT ... FROM k_const) / kc.* で参照する。
  WITH k_const AS (
    SELECT 5 AS k, 500 AS price_widen, 6 AS max_cards
  ),
  -- 裁定52: 段2の広げた価格。GREATEST の NULL 無視対策で CASE で包む。★1箇所★
  widened AS (
    SELECT
      CASE WHEN p_price_min IS NULL THEN NULL
           ELSE GREATEST(p_price_min - kc.price_widen, 0) END AS w_min,
      CASE WHEN p_price_max IS NULL THEN NULL
           ELSE p_price_max + kc.price_widen END              AS w_max
    FROM k_const kc
  ),
  -- 裁定51e: 所有 org（scalar opt_in の源）はここ1箇所だけ。RLS 経由(INVOKER)。
  --   非可視/不存在なら0行になる（裁定51a で false に落とす）。⛔ 例外を投げない。
  --   ★p_list_id が非 NULL のときのみ opt CTE が参照する（裁定-bm-A）。本文は不変。
  list_org AS (
    SELECT o.buyer_match_cards_opt_in AS opt_in
    FROM public.customer_lists cl
    JOIN public.organizations o ON o.id = cl.organization_id
    WHERE cl.id = p_list_id
  ),
  -- BM-10a(裁定-bm-A): p_list_id IS NULL のときの scalar opt_in。
  --   「呼び出し者が見える org のうち1つでも buyer_match_cards_opt_in が true なら true」。
  org_optin AS (
    SELECT EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id IN (SELECT public.current_user_org_ids())
        AND o.buyer_match_cards_opt_in
    ) AS opt_in
  ),
  -- scalar opt_in を p_list_id の有無で分岐（裁定-bm-A）。式は1箇所にまとめる。
  opt AS (
    SELECT CASE
             WHEN p_list_id IS NULL THEN (SELECT opt_in FROM org_optin)
             ELSE COALESCE((SELECT opt_in FROM list_org), false)
           END AS opt_in
  ),
  -- 母数（BM-4 の buy_rows と逐語同一＋裁定51b の org 単位オプトイン EXISTS）。
  buy_rows AS (
    SELECT
      r.id                  AS row_id,
      r.desired_muni_code_5 AS desired_muni_code_5
    FROM public.customer_list_rows r
    -- BM-10a(裁定-bm-A): p_list_id IS NULL=見える全名簿を合算（org スコープ）。非 NULL は従来同一。
    WHERE (p_list_id IS NULL OR r.list_id = p_list_id)
      AND r.deleted_at IS NULL
      AND r.lead_type = 'buy'
      AND r.inquiry_at IS NOT NULL
      AND r.inquiry_at >= now() - interval '12 months'
      AND public.current_user_plan() = 'platinum'
      AND r.organization_id IN (SELECT public.current_user_org_ids())
      -- 裁定51b: org 単位オプトイン（PostgREST 直叩きでも迂回不可の多層防御）。
      AND EXISTS (
        SELECT 1 FROM public.organizations o
        WHERE o.id = r.organization_id
          AND o.buyer_match_cards_opt_in
      )
  ),
  -- 裁定17: 希望市区町村の COALESCE 3段。★この式は本関数内でここ1箇所だけ★
  row_area AS (
    SELECT
      b.row_id              AS row_id,
      dd.school_district_id AS school_district_id,
      dd.match_method       AS match_method,
      COALESCE(b.desired_muni_code_5, dd.muni_code_5, sd.muni_code_5) AS muni_code_5
    FROM buy_rows b
    JOIN public.customer_list_row_desired_districts dd
      ON dd.row_id = b.row_id
    LEFT JOIN public.school_districts sd
      ON sd.id = dd.school_district_id
     AND sd.is_public IS TRUE
  ),
  area_known AS (
    SELECT ra.row_id, bool_or(ra.muni_code_5 IS NOT NULL) AS has_area
    FROM row_area ra
    GROUP BY ra.row_id
  ),
  -- 市区町村スコープ（希望エリア不明の行はここで落ちる・裁定17）。
  scoped AS (
    SELECT DISTINCT ra.row_id
    FROM row_area ra
    JOIN area_known ak ON ak.row_id = ra.row_id
    WHERE ak.has_area
      AND (p_muni_code_5 IS NULL OR ra.muni_code_5 = p_muni_code_5)
  ),
  -- 校区スコープ（裁定46・全段固定）。p_school_district_id IS NULL なら市区町村スコープと同集合。
  --   母数の宇宙＝ここ（BM-4 の near_scoped 相当）。段1〜4 はこの上で種別・価格だけを緩める。
  geo_scoped AS (
    SELECT DISTINCT ra.row_id
    FROM row_area ra
    JOIN scoped s ON s.row_id = ra.row_id
    WHERE p_school_district_id IS NULL
       OR (ra.school_district_id = p_school_district_id
           AND ra.match_method IN ('name_exact', 'name_normalized'))
  ),
  -- 行ごとに各段の該当可否を1回の走査で判定（裁定10 の再演回避）。
  --   q1=段1(種別＋価格) / q2=段2(種別＋広げた価格) / q3=段3(種別のみ)。
  --   q4(段4=種別も外す)＝この JOIN に現れる時点で子行が1本以上ある＝常に真（暗黙）。
  --   p_property_type IS NULL なら種別条件は無条件に縮退する（COMMENT 参照）。
  row_flags AS (
    SELECT
      gs.row_id,
      bool_or(
        (p_property_type IS NULL OR pt.property_type = p_property_type)
        -- 裁定13/18: 価格重なり（開区間・NULL 無制限・両側 NULL は該当）。
        AND (pt.price_min IS NULL OR p_price_max IS NULL OR pt.price_min <= p_price_max)
        AND (pt.price_max IS NULL OR p_price_min IS NULL OR pt.price_max >= p_price_min)
      ) AS q1,
      bool_or(
        (p_property_type IS NULL OR pt.property_type = p_property_type)
        -- 段2: 価格を widened(±price_widen) に置換。NULL は NULL のまま＝開区間（裁定52）。
        AND (pt.price_min IS NULL OR w.w_max IS NULL OR pt.price_min <= w.w_max)
        AND (pt.price_max IS NULL OR w.w_min IS NULL OR pt.price_max >= w.w_min)
      ) AS q2,
      bool_or(
        (p_property_type IS NULL OR pt.property_type = p_property_type)
      ) AS q3
    FROM geo_scoped gs
    JOIN public.customer_list_row_property_types pt ON pt.row_id = gs.row_id
    CROSS JOIN widened w
    GROUP BY gs.row_id
  ),
  -- 行ごとの「初めて該当する段」（段1⊆段2⊆段3⊆段4 の包含関係を利用）。
  row_stage AS (
    SELECT
      rf.row_id,
      CASE WHEN rf.q1 THEN 1
           WHEN rf.q2 THEN 2
           WHEN rf.q3 THEN 3
           ELSE 4 END AS s
    FROM row_flags rf
  ),
  -- 段 s の件数＝row_stage <= s の行数（行は既に DISTINCT）。
  stage_counts AS (
    SELECT
      count(*) FILTER (WHERE s <= 1) AS c1,
      count(*) FILTER (WHERE s <= 2) AS c2,
      count(*) FILTER (WHERE s <= 3) AS c3,
      count(*) FILTER (WHERE s <= 4) AS c4
    FROM row_stage
  ),
  -- 裁定48: k 判定は1つの CASE に集約（段ごとに4回別実装しない）。
  --   採用段＝c_s >= k となる最小の s。matched_count は採用段の件数（>=k）を lookup で拾う。
  chosen AS (
    SELECT
      x.stage,
      CASE x.stage
        WHEN 1 THEN x.c1 WHEN 2 THEN x.c2 WHEN 3 THEN x.c3 WHEN 4 THEN x.c4
        ELSE 0 END AS matched_count
    FROM (
      SELECT sc.c1, sc.c2, sc.c3, sc.c4,
        CASE
          WHEN sc.c1 >= kc.k THEN 1
          WHEN sc.c2 >= kc.k THEN 2
          WHEN sc.c3 >= kc.k THEN 3
          WHEN sc.c4 >= kc.k THEN 4
          ELSE NULL
        END AS stage
      FROM stage_counts sc CROSS JOIN k_const kc
    ) x
  ),
  -- 裁定53①②: 採用段の DISTINCT row_id 集合に ORDER BY random() LIMIT max_cards。
  --   ⛔ property_types と JOIN した状態で LIMIT しない（row_stage は1行1 row_id）。
  -- ★MATERIALIZED 必須（裁定55）: 3箇所から参照される。インラインされると
  --   参照ごとに random() が再評価され、別々の6人になってカードが壊れる。
  picked AS MATERIALIZED (
    SELECT rs.row_id
    FROM row_stage rs, chosen ch
    WHERE ch.stage IS NOT NULL
      AND rs.s <= ch.stage
    ORDER BY random()
    LIMIT (SELECT max_cards FROM k_const)
  ),
  -- 裁定47/53③: property_types はその人の希望すべて（sort_order 順・p_property_type で絞らない）。
  --   price_min/price_max はその人の希望レンジの外包（min の下限・max の上限）。
  card_types AS (
    SELECT
      pt.row_id,
      array_agg(pt.property_type ORDER BY t.sort_order) AS property_types,
      min(pt.price_min) AS price_min,
      max(pt.price_max) AS price_max
    FROM public.customer_list_row_property_types pt
    JOIN public.property_types t ON t.code = pt.property_type
    JOIN picked pk ON pk.row_id = pt.row_id
    GROUP BY pt.row_id
  ),
  -- 裁定47/54: desired_districts は公開校名のみ・重複排除・校名順。該当なしは空配列。
  card_districts AS (
    SELECT
      dd.row_id,
      to_jsonb(array_agg(DISTINCT sd.school_name ORDER BY sd.school_name)) AS districts
    FROM public.customer_list_row_desired_districts dd
    JOIN public.school_districts sd
      ON sd.id = dd.school_district_id
     AND sd.is_public IS TRUE
    JOIN picked pk ON pk.row_id = dd.row_id
    WHERE dd.match_method IN ('name_exact', 'name_normalized')
    GROUP BY dd.row_id
  ),
  -- カード配列。⛔ 裁定47: キーは下記8つに限定する（「型で防ぐ」）。
  --   row_id / list_id / user_id / organization_id / external_id / customer_name / assignee
  --   / inquiry_at / media / category / address_* / desired_school / input_name
  --   / normalized_name / match_method / candidate_count は返さない。
  cards_agg AS (
    SELECT COALESCE(jsonb_agg(c.card ORDER BY random()), '[]'::jsonb) AS cards
    FROM (
      SELECT jsonb_build_object(
        'property_types',         to_jsonb(ct.property_types),
        'price_min',              ct.price_min,
        'price_max',              ct.price_max,
        'desired_floor_area_min', r.desired_floor_area_min,
        'desired_floor_area_max', r.desired_floor_area_max,
        'desired_land_area_min',  r.desired_land_area_min,
        'desired_land_area_max',  r.desired_land_area_max,
        'desired_districts',      COALESCE(cd.districts, '[]'::jsonb)
      ) AS card
      FROM picked pk
      JOIN public.customer_list_rows r ON r.id = pk.row_id
      JOIN card_types ct               ON ct.row_id = pk.row_id
      LEFT JOIN card_districts cd       ON cd.row_id = pk.row_id
    ) c
  ),
  -- 裁定41/48: 見出しの「実際に使った条件」。採用段が無ければ NULL。
  --   段4 は種別 null / 段3以降は価格 null / 段2 は widened / 段1 は元の値。
  used_cond AS (
    SELECT
      CASE WHEN ch.stage IS NULL THEN NULL ELSE
        jsonb_build_object(
          'muni_code_5',        p_muni_code_5,
          'school_district_id', p_school_district_id,
          'property_type',      CASE WHEN ch.stage = 4 THEN NULL ELSE p_property_type END,
          'price_min',          CASE ch.stage WHEN 1 THEN p_price_min WHEN 2 THEN w.w_min ELSE NULL END,
          'price_max',          CASE ch.stage WHEN 1 THEN p_price_max WHEN 2 THEN w.w_max ELSE NULL END
        )
      END AS uc
    FROM chosen ch CROSS JOIN widened w
  )
  -- 裁定51c: opt_in=false は CASE で短絡（chosen/picked/random() を評価しない）。
  --   opt_in=true でも全段 k 未満なら stage=null / matched_count=0 / suppressed=true / cards=[]（裁定48）。
  SELECT jsonb_build_object(
    'opt_in',          o.opt_in,
    'k',               (SELECT k FROM k_const),
    'max_cards',       (SELECT max_cards FROM k_const),
    'stage',           CASE WHEN o.opt_in THEN (SELECT stage FROM chosen) ELSE NULL END,
    'used_conditions', CASE WHEN o.opt_in THEN (SELECT uc FROM used_cond) ELSE NULL END,
    'matched_count',   CASE WHEN o.opt_in THEN (SELECT matched_count FROM chosen) ELSE 0 END,
    'suppressed',      CASE WHEN o.opt_in THEN ((SELECT stage FROM chosen) IS NULL) ELSE false END,
    'cards',           CASE WHEN o.opt_in THEN (SELECT cards FROM cards_agg) ELSE '[]'::jsonb END
  )
  FROM opt o;
$$;

COMMENT ON FUNCTION public.get_buyer_match_cards(uuid, text, uuid, text, integer, integer) IS
  'PR-BM-9a（裁定40〜54）: 売主の物件条件に対し、当該 org の買い希望(lead_type=''buy'')から匿名カードを最大6枚返す(jsonb)。'
  '返り値: opt_in / k(=5) / max_cards(=6) / stage(1〜4・全段 k 未満は null・opt_in=false も null) / '
  'used_conditions(採用段の実際に使った条件・null 可) / matched_count(採用段の該当者数>=k・抑止/opt_in=false は 0) / '
  'suppressed(全段 k 未満なら true・opt_in=false は false) / cards(0〜6件・ランダム順)。'
  '⛔ 段の途中経過を返さない。⛔ 5 未満の実数を返さない（採用段の件数のみ・裁定48）。'
  '段の自動降格(裁定): 段1=指定価格レンジ＋種別 / 段2=価格を±500万円広げる＋種別 / 段3=価格を外す(種別のみ) / '
  '段4=種別も外す(市内の全買い反響)。5名以上になった段で止め、段4でも5名未満なら初めてカードなし。'
  '裁定44: オプトイン判定は関数内(organizations.buyer_match_cards_opt_in)。PostgREST 直叩きでも迂回不可(多層防御)。'
  '裁定46: p_school_district_id は降格の対象外(全段固定)。BM-7 は NULL で呼ぶ。'
  '裁定45: random() で抽出と並びを行うため VOLATILE。'
  '裁定47: カード1枚は property_types(希望種別すべて・sort_order 順・p_property_type で絞らない) / price_min / price_max(外包) / '
  'desired_floor_area_min/max / desired_land_area_min/max / desired_districts(公開校名のみ・name_exact|name_normalized・重複排除・校名順・無ければ空配列)。'
  '⛔ row_id/list_id/user_id/organization_id/external_id/customer_name/assignee/inquiry_at/media/category/'
  'address_*/desired_school/input_name/normalized_name/match_method/candidate_count は返さない(jsonb キーを上記8つに限定)。'
  '縮退: p_property_type IS NULL のとき段1〜3 の種別条件が無条件になる(BM-9b の API は property_type を必須にするので RPC は NULL を許容)。'
  '裁定51: scalar opt_in は customer_lists.organization_id の org フラグ。非可視/不存在は false に落とし(⛔例外を投げない)、'
  'opt_in=false は母数計算に入る前に短絡(カウントも random() も走らせない)。母数側の per-row EXISTS(opt_in) は多層防御として残す。'
  '「非可視/不存在」と「opt_in=OFF」は返り分けしない(存在確認は BM-9b の API が 404)。'
  '裁定16: 直近12ヶ月。裁定17: 希望市区町村は COALESCE(desired_muni_code_5, dd.muni_code_5, sd.muni_code_5)、3つとも NULL の行は母数外。'
  'SECURITY INVOKER で RLS(org スコープ)が効くうえ、service_role の RLS バイパスに備え '
  'current_user_plan()=platinum・organization_id∈current_user_org_ids()・school_districts.is_public を関数側でも明示。'
  'BM-10a(裁定-bm-A): p_list_id IS NULL=呼び出し者が RLS で見えるすべての名簿を合算する(org スコープ)。'
  'p_list_id が非 NULL のときの挙動は従来と一字一句同じである。'
  'scalar opt_in は p_list_id IS NULL のとき「見える org のいずれか1つが ON なら true」。'
  'ただし母数は per-row EXISTS(buyer_match_cards_opt_in) により ON の org の行のみ。'
  'scalar は応答全体のゲートであり母数の広さには関与しない。';

-- deny-by-default: PUBLIC/anon から実行権を剥奪し、authenticated のみに付与。
REVOKE ALL ON FUNCTION public.get_buyer_match_cards(uuid, text, uuid, text, integer, integer) FROM PUBLIC, anon;
-- ★O109: Supabase の ALTER DEFAULT PRIVILEGES が新規 public 関数へ service_role の
--   EXECUTE を自動付与するため、明示的に剥がす(PUBLIC/anon の REVOKE では剥がれない)。
REVOKE ALL ON FUNCTION public.get_buyer_match_cards(uuid, text, uuid, text, integer, integer) FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_buyer_match_cards(uuid, text, uuid, text, integer, integer) TO authenticated;


-- =====================================================================
-- (3) get_customer_list_areas — org スコープ対応（l.id 絞りのみ変更）
--   ★本文は 20260826000100_list_areas_rpc.sql 48-110 行の逐語コピー。
--     差分は WHERE の list_id 絞り 1行（86 行）と COMMENT の追記のみ。
--     原本は CREATE FUNCTION だが本 PR は CREATE OR REPLACE で置換（DROP 不使用）。
--   ⚠ 本関数は索引であって集計ではない（COUNT/n を返さず k 抑止を持たない・SD-45）。
--     org スコープ化でもこの性質は不変（抑止ロジックは存在しないため触れない）。
--   4条件充足（手順1で確認）: LANGUAGE sql / STABLE / SECURITY INVOKER /
--     search_path 固定 / GRANT は authenticated のみ（service_role・anon なし）。
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_customer_list_areas(
  p_list_id     uuid,
  p_school_type text DEFAULT 'elementary'
)
RETURNS TABLE (
  muni_code_5          text,
  muni_name            text,
  prefecture_name      text,
  has_school_districts boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    m.city_code AS muni_code_5,
    m.name      AS muni_name,
    pf.name     AS prefecture_name,
    -- 公開校区(is_public IS TRUE)が当該校種で存在するか。生件数は返さない。
    EXISTS (
      SELECT 1
      FROM public.school_districts sd
      WHERE sd.muni_code_5 = m.city_code
        AND sd.school_type = p_school_type
        AND sd.is_public IS TRUE
    ) AS has_school_districts
  -- (b) 名簿本体（RLS: 自分の org の行のみ SELECT 可）。org 判定は関数側でも明示。
  FROM public.customer_lists l
  -- (c) 名簿の行。索引なので match_status は問わない。削除行と未突合(muni NULL)を除外。
  JOIN public.customer_list_rows r
    ON r.list_id = l.id
  -- (d) 当たった自治体。municipality_id(uuid) 経由で結合（桁合わせ JOIN はしない）。
  JOIN public.municipalities m
    ON m.id = r.municipality_id
  -- (e) 県名は prefecture_code で LEFT JOIN（未整備でも自治体行は落とさない）。
  LEFT JOIN public.prefectures pf
    ON pf.code = m.prefecture_code
  -- BM-10a(裁定-bm-A): p_list_id IS NULL=見える全名簿を合算（org スコープ）。非 NULL は従来同一。
  WHERE (p_list_id IS NULL OR l.id = p_list_id)
    -- 索引のため 12ヶ月フィルタ(inquiry_at)はかけない（SD-45）。
    AND r.deleted_at IS NULL
    AND r.municipality_id IS NOT NULL
    -- allowlist 外(compulsory・想定外)は結果を返さない
    AND p_school_type IN ('elementary', 'junior_high')
    -- 多層防御(service_role の RLS バイパス経路を関数側で塞ぐ)
    AND public.current_user_plan() = 'platinum'
    AND l.organization_id IN (SELECT public.current_user_org_ids())
    -- 行側の org も検証（heatmap RPC と同じく r 側で判定。行 org とリスト org の
    --   食い違い整合性違反時の漏れを塞ぐ）。
    AND r.organization_id IN (SELECT public.current_user_org_ids())
  -- 同一自治体 1 行に dedupe（COUNT は取らない）。ORDER/GROUP は別名で修飾する。
  GROUP BY m.prefecture_code, m.city_code, m.name, pf.name
  ORDER BY m.prefecture_code, m.city_code;
$$;

COMMENT ON FUNCTION public.get_customer_list_areas(uuid, text) IS
  'M2-6b/SD-44: 顧客リストが当たった自治体の索引一覧を返す（集計ではなく索引＝生件数は返さない・12ヶ月フィルタなし SD-45）。返り列: muni_code_5(=municipalities.city_code 5桁)/muni_name/prefecture_name(prefectures を prefecture_code で LEFT JOIN)/has_school_districts(公開校区 is_public IS TRUE の EXISTS を p_school_type で絞って導出)。municipality_id(uuid) 経由で municipalities に結合し、r.deleted_at IS NULL かつ r.municipality_id IS NOT NULL のみ、同一自治体は 1 行に dedupe。SECURITY INVOKER で RLS(org スコープ)が効くうえ、service_role の RLS バイパスに備え current_user_plan()=platinum(SD-40)・l.organization_id・r.organization_id ∈ current_user_org_ids()・is_public を関数側でも明示。allowlist=elementary/junior_high(それ以外は空)。引数: p_list_id=対象の customer_lists.id / p_school_type=has_school_districts 判定の校種(既定 elementary)。'
  'BM-10a(裁定-bm-A): p_list_id IS NULL=呼び出し者が RLS で見えるすべての名簿を合算する(org スコープ)。'
  'p_list_id が非 NULL のときの挙動は従来と一字一句同じである。'
  '本関数は索引であって集計ではない(COUNT/n を返さず k 抑止を持たない・SD-45)。org スコープ化でもこの性質は不変。';

-- deny-by-default: PUBLIC/anon/service_role から実行権を剥奪し、authenticated のみに付与。
-- ★O109: 新規 public 関数へ service_role の EXECUTE が自動付与されるため、
--   「GRANT しない」だけでは剥がれない。service_role を明示的に REVOKE する(#74 と同理由)。
REVOKE ALL ON FUNCTION public.get_customer_list_areas(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_list_areas(uuid, text) TO authenticated;

COMMIT;

-- =====================================================================
-- ROLLBACK: 旧本文へ CREATE OR REPLACE で差し戻す（⛔ DROP FUNCTION は使わない）。
--   下記の「旧本文」はいずれも現行 migration からの逐語コピー（記憶で再構成していない）:
--     (1) get_buyer_match_summary  … 20260909000300_bm4_buyer_match_rpcs.sql 80-216 行
--     (2) get_buyer_match_cards    … 20260911000100_bm9a_buyer_match_cards.sql 85-365 行
--     (3) get_customer_list_areas  … 20260826000100_list_areas_rpc.sql 48-110 行
--   差し戻しの要点（逐語コピー元の該当箇所のみ変える）:
--     (1) buy_rows の WHERE を「WHERE r.list_id = p_list_id」に戻す（他は同一）。
--         COMMENT は BM-10a 追記2行を除いた旧文言に戻す。
--     (2) list_org/opt を旧2 CTE（org_optin を削除し、
--         opt を「SELECT COALESCE((SELECT opt_in FROM list_org), false) AS opt_in」に戻す）、
--         buy_rows の WHERE を「WHERE r.list_id = p_list_id」に戻す（他は同一）。
--         COMMENT は BM-10a 追記5行を除いた旧文言に戻す。
--     (3) WHERE を「WHERE l.id = p_list_id」に戻す（他は同一）。
--         COMMENT は BM-10a 追記3行を除いた旧文言に戻す。
--         ⚠ 原本 20260826000100 は CREATE FUNCTION だが、差し戻しも CREATE OR REPLACE で行う。
--   ※ 版番号台帳(schema_migrations)から 20260912000100 の行も削除すること。
-- =====================================================================

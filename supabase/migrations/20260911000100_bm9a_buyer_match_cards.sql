-- =====================================================================
-- 20260911000100_bm9a_buyer_match_cards.sql
-- PR-BM-9a / Tier1: 購入希望マッチ「匿名カード」RPC ＋ organizations オプトイン列。
--   決定: 2026-09-09 夜 PO 採用（Vault 2026-09-09 §21〜§23）＋ PM 裁定40〜54（9/11）。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う（R7・D57）。
--   ※ supabase db push は恒久禁止。適用後は台帳
--     supabase_migrations.schema_migrations への INSERT を忘れないこと（本 PR 版番号=20260911000100）。
--
-- 【本 PR で作るもの】
--   (A) public.organizations.buyer_match_cards_opt_in boolean NOT NULL DEFAULT false（裁定44）
--       … org 単位の匿名カード オプトイン。既定 OFF。画面からの自己 ON は構造的に不可
--         （organizations は authenticated=SELECT のみ・UPDATE は postgres/service_role のみ）。
--         ON/OFF は PM がコネクタで行う。⛔ organizations の RLS・policy・GRANT は一切変更しない
--         （本ファイルは ADD COLUMN と COMMENT のみ）。
--   (B) public.get_buyer_match_cards(uuid, text, uuid, text, integer, integer) RETURNS jsonb（裁定43）
--       … 売主の物件条件に対し、当該 org の買い希望（lead_type='buy'）から匿名カードを最大6枚返す。
--         段の自動降格（段1→2→3→4）で「5名以上になった段」で止め、その段の該当者を
--         ランダムに最大6枚。全段 k=5 未満なら cards なし。⛔ 段の途中経過・5未満の実数は返さない。
--
-- 【BM-4（20260909000300）を逐語で踏襲する規約】
--   - LANGUAGE sql / SECURITY INVOKER / SET search_path = public, pg_temp
--   - ★裁定45: 本関数だけ VOLATILE（random() で抽出と並びを行うため。STABLE のまま random() を呼ばない）。
--   - 多層防御を関数側でも明示: current_user_plan()='platinum'
--       / organization_id ∈ current_user_org_ids() / school_districts.is_public
--   - 現存条件: r.deleted_at IS NULL AND r.lead_type='buy'
--   - 裁定16・直近12ヶ月: r.inquiry_at IS NOT NULL AND r.inquiry_at >= now() - interval '12 months'
--   - 校区突合は match_method IN ('name_exact','name_normalized') のみ
--   - 物件種別は customer_list_row_property_types を使い is_primary は問わない
--   - 集計は count(*) FILTER（row_flags で行を GROUP BY 済＝行は既に DISTINCT・裁定19 と同義）
--   - REVOKE ALL FROM PUBLIC, anon → REVOKE ALL FROM service_role(O109) → GRANT EXECUTE TO authenticated
--
-- 【裁定49・定数の一元化】k=5 / price_widen=500(万円) / max_cards=6 は k_const の1箇所だけ。
--   ⛔ 5・500・6 を式に直書きしない。
-- 【裁定17・希望市区町村】COALESCE(r.desired_muni_code_5, dd.muni_code_5, sd.muni_code_5) を
--   row_area CTE の1箇所だけに書く。3つとも NULL の行は母数に含めない（本関数は unknown_area_count を返さない）。
-- 【裁定46・校区スコープは全段固定】p_school_district_id は降格の対象外。
--   非 NULL なら段1〜4 の全段で固定条件（BM-7 は NULL で呼ぶ・裁定33）。
-- 【裁定51・scalar opt_in】所有 org は customer_lists.organization_id（list_org CTE 1箇所・裁定51e）。
--   RLS 経由(INVOKER)。非可視/不存在は0行→ COALESCE(...,false)（裁定51a・⛔例外を投げない）。
--   opt_in=false は母数計算に入る前に短絡（裁定51c・CASE でカウントも random() も走らせない）。
--   母数側の per-row EXISTS(organizations … opt_in) は残す（裁定51b・多層防御）。
--   「非可視/不存在」と「opt_in=OFF」は返り分けしない（裁定51d・存在確認は BM-9b の API が 404）。
-- 【裁定52・段2の価格拡張】GREATEST の NULL 無視で「下限なし」が「下限0」に化けるのを防ぐ:
--     w_min = CASE WHEN p_price_min IS NULL THEN NULL ELSE GREATEST(p_price_min - price_widen, 0) END
--     w_max = CASE WHEN p_price_max IS NULL THEN NULL ELSE p_price_max + price_widen END
--   段2の判定と used_conditions の両方で使うため widened CTE 1箇所に置いて参照する。
-- 【裁定53・抽出順序】① 採用段の row_id を DISTINCT で確定 → ② ORDER BY random() LIMIT max_cards
--   → ③ その row_id 集合にカード内容を組む。⛔ property_types と JOIN した状態で LIMIT しない。
-- 【裁定54・desired_districts】重複排除して校名で並べる（1行が elementary/junior_high の2件を持ち得る）。
--   sd.is_public IS TRUE かつ match_method IN ('name_exact','name_normalized')。該当なしは空配列。
--
-- 【前提スキーマ（migration 実物で確認済・手順1／PM 本番実測）】
--   customer_lists: id / organization_id(NOT NULL・NULL 0件) / SELECT policy=cl_select_org
--   organizations: id / name / is_personal / created_at / updated_at ＋ 本 PR で buyer_match_cards_opt_in
--     RLS=有効・policy は org_select_member(SELECT) の1本のみ・GRANT は authenticated=SELECT のみ
--   customer_list_rows: id / list_id / organization_id / deleted_at / lead_type / inquiry_at
--     / desired_muni_code_5 / desired_floor_area_min / _max / desired_land_area_min / _max
--   customer_list_row_property_types: PK(row_id, property_type) / price_min / price_max(万円)
--   customer_list_row_desired_districts: PK(row_id, school_type) / school_district_id / muni_code_5
--     / match_method(6値: name_exact/name_normalized/ambiguous/unmatched/out_of_coverage/no_input)
--   property_types: code / label_ja / sort_order（6値）
--   school_districts: id / school_name / is_public（生成列）
--   public.current_user_plan() -> text / public.current_user_org_ids() -> SETOF uuid
-- =====================================================================

BEGIN;

-- =====================================================================
-- (A) organizations に匿名カード オプトイン列を追加（裁定44）
--   ⛔ ADD COLUMN と COMMENT のみ。RLS・policy・GRANT は一切変更しない。
-- =====================================================================
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS buyer_match_cards_opt_in boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.buyer_match_cards_opt_in IS
  'BM-9a（裁定44）: 購入希望マッチ「匿名カード」の org 単位オプトイン。既定 false。'
  '画面からの自己 ON は構造的に不可（organizations は authenticated=SELECT のみ・UPDATE は postgres/service_role のみ）。'
  'ON/OFF は PM がコネクタで行う。get_buyer_match_cards がこの列で母数と返り値の opt_in を判定する（多層防御）。';


-- =====================================================================
-- (B) get_buyer_match_cards — 売主向け 匿名カード（最大6枚・段の自動降格）
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
  list_org AS (
    SELECT o.buyer_match_cards_opt_in AS opt_in
    FROM public.customer_lists cl
    JOIN public.organizations o ON o.id = cl.organization_id
    WHERE cl.id = p_list_id
  ),
  opt AS (
    SELECT COALESCE((SELECT opt_in FROM list_org), false) AS opt_in
  ),
  -- 母数（BM-4 の buy_rows と逐語同一＋裁定51b の org 単位オプトイン EXISTS）。
  buy_rows AS (
    SELECT
      r.id                  AS row_id,
      r.desired_muni_code_5 AS desired_muni_code_5
    FROM public.customer_list_rows r
    WHERE r.list_id = p_list_id
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
  picked AS (
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
  'current_user_plan()=platinum・organization_id∈current_user_org_ids()・school_districts.is_public を関数側でも明示。';

-- deny-by-default: PUBLIC/anon から実行権を剥奪し、authenticated のみに付与。
REVOKE ALL ON FUNCTION public.get_buyer_match_cards(uuid, text, uuid, text, integer, integer) FROM PUBLIC, anon;
-- ★O109: Supabase の ALTER DEFAULT PRIVILEGES が新規 public 関数へ service_role の
--   EXECUTE を自動付与するため、明示的に剥がす(PUBLIC/anon の REVOKE では剥がれない)。
REVOKE ALL ON FUNCTION public.get_buyer_match_cards(uuid, text, uuid, text, integer, integer) FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_buyer_match_cards(uuid, text, uuid, text, integer, integer) TO authenticated;

COMMIT;

-- =====================================================================
-- ROLLBACK:
--   BEGIN;
--     DROP FUNCTION IF EXISTS public.get_buyer_match_cards(uuid, text, uuid, text, integer, integer);
--     ALTER TABLE public.organizations DROP COLUMN IF EXISTS buyer_match_cards_opt_in;
--       -- ⚠ 列 DROP はオプトインのフラグ値(どの org が ON か)を失う。復旧は PM が再設定する。
--   COMMIT;
--   ※ 本 PR は新設のみ(関数の置き換えなし)。organizations の RLS/policy/GRANT は変更していないため
--     切り戻しでも触らない。
--
-- 検証（適用後・PM 用）: scripts/sql/verify_bm9a_buyer_match_cards.sql を実行する。
--   ・organizations.buyer_match_cards_opt_in が boolean/NOT NULL/default false・全行 false
--   ・organizations の GRANT=authenticated SELECT のみ・policy 数=1(org_select_member) が不変
--   ・get_buyer_match_cards: prosecdef=false(INVOKER) / provolatile='v'(VOLATILE) /
--     proconfig に search_path / 引数6つ(uuid,text,uuid,text,integer,integer) / オーバーロード数1
--   ・proacl に service_role/anon/PUBLIC が居ないこと
--   ・本文の jsonb_build_object キーに禁止列が現れないこと（目視）
-- =====================================================================

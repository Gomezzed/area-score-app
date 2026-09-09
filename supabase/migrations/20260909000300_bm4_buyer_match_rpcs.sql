-- =====================================================================
-- 20260909000300_bm4_buyer_match_rpcs.sql
-- PR-BM-4 / Tier1: 購入希望マッチ 照合 RPC 3本（集計・セル集計・社内個票）。
--   決定: 2026-09-09 PM 裁定13〜21（BM-4 セッション）。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う（R7・D57）。
--   ※ supabase db push は恒久禁止。適用後は台帳
--     supabase_migrations.schema_migrations への INSERT を忘れないこと。
--
-- 【本 PR で作るもの】いずれも「売主の物件条件」を引数に取り、当該 org の
--   買い希望（customer_list_rows.lead_type='buy'）を数える読み取り RPC。
--   R1 public.get_buyer_match_summary  … 「128名／うち6名」に当たる2つの数（jsonb）
--   R2 public.get_buyer_match_cells    … 「内訳カード」に当たるセル集計（TABLE）
--   R3 public.get_buyer_match_rows     … 社内向けの個票（TABLE）★売主に見せない
--
-- 【裁定21・命名】当初案の match_buyer_* は撤回し get_buyer_match_* に改めた。
--   既存慣行では match_ = plpgsql / SECURITY DEFINER / EXECUTE は service_role のみ
--   （match_customer_list_rows・match_customer_list_desired_districts）であり、
--   get_ = STABLE / SECURITY INVOKER / authenticated 付与の読み取り集計
--   （get_school_district_heatmap・get_customer_list_areas）。本3本は後者。
--
-- 【3本に共通する規約】20260909000200(BM-3) を逐語で踏襲する。
--   - LANGUAGE sql / STABLE / SECURITY INVOKER / SET search_path = public, pg_temp
--   - 多層防御を関数側でも明示（service_role の RLS バイパスに備える）:
--       public.current_user_plan() = 'platinum'
--       r.organization_id IN (SELECT public.current_user_org_ids())
--   - 現存条件は既存に揃える: r.deleted_at IS NULL AND r.lead_type = 'buy'
--   - 裁定16・直近12ヶ月: r.inquiry_at IS NOT NULL
--       AND r.inquiry_at >= now() - interval '12 months'
--     （BM-3 の get_school_district_heatmap は本 PR では変更しない＝別 PR で揃える）
--   - 校区の突合は customer_list_row_desired_districts の
--     match_method IN ('name_exact','name_normalized') のみ
--   - 物件種別は customer_list_row_property_types を使い is_primary は問わない
--     （価格のみの行も母数に含める）
--   - 集計は count(DISTINCT ...)（裁定19・JOIN 追加時の重複計上を構造的に防ぐ）
--   - ⛔ 生件数を返してよいのは R3 のみ。R1・R2 は k 抑止後の値だけ
--   - REVOKE ALL FROM PUBLIC, anon → REVOKE ALL FROM service_role(O109)
--     → GRANT EXECUTE TO authenticated
--
-- 【裁定17・希望市区町村の決め方】買い行の「希望市区町村」は次の優先順で決める。
--     COALESCE(r.desired_muni_code_5, dd.muni_code_5, sd.muni_code_5)
--       1. r.desired_muni_code_5 … 将来 PR-D で埋まる。埋まればこれが最優先。
--          ※ PM が本番で実測: 現時点で 223 行すべて NULL（BM-2 は永続化しない）。
--             したがってこの列単独では母数が常に 0 になる。
--       2. dd.muni_code_5 … customer_list_row_desired_districts の探索スコープ
--          （スコープが1件のときだけ入る）。
--       3. sd.muni_code_5 … match_method が name_exact/name_normalized のとき、
--          一致した校区の市区町村。
--   この式は各関数の本体で **row_area CTE の1箇所だけ** に書く（同じ式を2回書かない）。
--   dd は買い行に対して常に1行あるため通常の JOIN。sd は school_district_id が
--   NULL のケースがあるため LEFT JOIN（かつ is_public IS TRUE を明示＝多層防御）。
--   ⚠ 3つとも NULL の行は「希望エリア不明」として母数に含めない。件数は R1 の
--     unknown_area_count で返す（k 抑止の対象外・充足率の観測用）。
--
-- 【裁定18・価格の重なり判定】売主 [p_price_min, p_price_max] と
--   買主 [pt.price_min, pt.price_max] が少しでも重なれば該当。開区間・NULL は無制限。
--   両側 NULL は「価格の希望なし」として該当扱い（裁定13 と一致）。
--
-- 【裁定20・k の定数化】k=5 は WITH k_const AS (SELECT 5 AS k) の1箇所だけに置き、
--   HAVING / CASE からは (SELECT k FROM k_const) で参照する。⛔ 5 を式に直書きしない。
--
-- 【前提スキーマ（migration 実物で確認済・手順1）】
--   customer_list_rows: id / list_id / organization_id / deleted_at / lead_type
--     / inquiry_at / external_id / customer_name / assignee / desired_muni_code_5
--     / desired_floor_area_min / desired_floor_area_max
--   customer_list_row_property_types: PK(row_id, property_type) / price_min / price_max
--     / is_primary / organization_id  ※price は万円・CHECK(>=0, min<=max)
--   customer_list_row_desired_districts: PK(row_id, school_type) / school_district_id
--     / muni_code_5 / match_method(6値) / organization_id
--   property_types: code / label_ja / sort_order  ※RLS: authenticated は SELECT 可
--   school_districts: id / muni_code_5 / is_public  ※RLS: is_public = true のみ可視
--   public.current_user_plan() -> text / public.current_user_org_ids() -> SETOF uuid
-- =====================================================================

BEGIN;

-- =====================================================================
-- R1: get_buyer_match_summary — 売主向けサマリ（wide / near の2つの数）
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
    WHERE r.list_id = p_list_id
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
  'current_user_plan()=platinum・organization_id∈current_user_org_ids()・school_districts.is_public を関数側でも明示。';

-- deny-by-default: PUBLIC/anon から実行権を剥奪し、authenticated のみに付与。
-- (新規 public RPC は anon にも自動で EXECUTE が付くため anon を明示的に REVOKE する)
REVOKE ALL ON FUNCTION public.get_buyer_match_summary(uuid, text, uuid, text, integer, integer) FROM PUBLIC, anon;
-- ★O109: Supabase の ALTER DEFAULT PRIVILEGES が新規 public 関数へ service_role の
--   EXECUTE を自動付与するため、明示的に剥がす(PUBLIC/anon の REVOKE では剥がれない・#74 と同理由)。
REVOKE ALL ON FUNCTION public.get_buyer_match_summary(uuid, text, uuid, text, integer, integer) FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_buyer_match_summary(uuid, text, uuid, text, integer, integer) TO authenticated;


-- =====================================================================
-- R2: get_buyer_match_cells — 内訳カード（物件種別 × 価格帯 × 専有面積帯）
-- =====================================================================
-- ⚠ p_price_min / p_price_max は使わない（セルは全価格帯を返す）。引数の並びを
--   R1・R3 と揃えるためにシグネチャからは外さない。
CREATE OR REPLACE FUNCTION public.get_buyer_match_cells(
  p_list_id            uuid,
  p_muni_code_5        text,
  p_school_district_id uuid,
  p_property_type      text,
  p_price_min          integer,
  p_price_max          integer
)
RETURNS TABLE (
  property_type         text,
  label_ja              text,
  price_bucket_min      integer,
  price_bucket_max      integer,
  floor_area_bucket_min integer,
  floor_area_bucket_max integer,
  n                     integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  -- 裁定20: k とバケット幅はここ1箇所。price_cap は generate_series の暴走防止
  --   （万円単位。10億円を超える希望価格は軸の上限で頭打ちにする）。
  WITH k_const AS (
    SELECT 5 AS k, 500 AS price_step, 20 AS area_step, 100000 AS price_cap
  ),
  buy_rows AS (
    SELECT
      r.id                     AS row_id,
      r.desired_muni_code_5    AS desired_muni_code_5,
      r.desired_floor_area_min AS desired_floor_area_min,
      r.desired_floor_area_max AS desired_floor_area_max
    FROM public.customer_list_rows r
    WHERE r.list_id = p_list_id
      AND r.deleted_at IS NULL
      AND r.lead_type = 'buy'
      AND r.inquiry_at IS NOT NULL
      AND r.inquiry_at >= now() - interval '12 months'
      AND public.current_user_plan() = 'platinum'
      AND r.organization_id IN (SELECT public.current_user_org_ids())
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
  scoped AS (
    SELECT DISTINCT ra.row_id
    FROM row_area ra
    JOIN area_known ak ON ak.row_id = ra.row_id
    WHERE ak.has_area
      AND (p_muni_code_5 IS NULL OR ra.muni_code_5 = p_muni_code_5)
  ),
  -- 対象は当該校区。p_school_district_id を NULL で渡したら市区町村スコープ。
  near_scoped AS (
    SELECT DISTINCT ra.row_id
    FROM row_area ra
    JOIN scoped s ON s.row_id = ra.row_id
    WHERE p_school_district_id IS NULL
       OR (ra.school_district_id = p_school_district_id
           AND ra.match_method IN ('name_exact', 'name_normalized'))
  ),
  -- セルの素になる (行 × 希望物件種別)。is_primary は問わない。
  cand AS (
    SELECT
      ns.row_id                  AS row_id,
      pt.property_type           AS property_type,
      pt.price_min               AS price_min,
      pt.price_max               AS price_max,
      b.desired_floor_area_min   AS desired_floor_area_min,
      b.desired_floor_area_max   AS desired_floor_area_max
    FROM near_scoped ns
    JOIN buy_rows b ON b.row_id = ns.row_id
    JOIN public.customer_list_row_property_types pt
      ON pt.row_id = ns.row_id
    WHERE p_property_type IS NULL OR pt.property_type = p_property_type
  ),
  -- 裁定14: 面積帯はセルの見出しにのみ使う（絞り込みには使わない）。
  --   1行につき1バケット。代表値は下限、下限が無ければ上限。両方 NULL は NULL バケット。
  cand_area AS (
    SELECT
      c.row_id,
      c.property_type,
      c.price_min,
      c.price_max,
      (floor(COALESCE(c.desired_floor_area_min, c.desired_floor_area_max)::numeric / kc.area_step)
        * kc.area_step)::integer AS ab_min
    FROM cand c
    CROSS JOIN k_const kc
  ),
  -- 価格軸: スコープ内の実データが張る範囲だけを生成する（無限展開を防ぐ）。
  --   下限は price_min NULL(＝下限なし)を 0 とみなす。上限は price_max NULL の行は
  --   price_min で代表させ、price_cap で頭打ちにする。
  axis_raw AS (
    SELECT
      min(COALESCE(c.price_min, 0))                AS lo_raw,
      max(COALESCE(c.price_max, c.price_min))      AS hi_raw
    FROM cand c
  ),
  price_axis AS (
    SELECT gs::integer AS pb_min, (gs + kc.price_step)::integer AS pb_max
    FROM axis_raw ar
    CROSS JOIN k_const kc
    CROSS JOIN LATERAL generate_series(
      (floor(COALESCE(ar.lo_raw, 0)::numeric / kc.price_step) * kc.price_step)::integer,
      (floor(LEAST(COALESCE(ar.hi_raw, 0), kc.price_cap)::numeric / kc.price_step) * kc.price_step)::integer,
      kc.price_step
    ) AS gs
  ),
  cells AS (
    -- ① 価格希望のある行: 希望レンジが重なるすべてのバケットに 1 ずつ計上する
    --    （レンジが3バケットに跨れば3セルに現れる）。バケットは半開区間 [pb_min, pb_max)。
    SELECT
      ca.property_type AS property_type,
      ax.pb_min        AS pb_min,
      ax.pb_max        AS pb_max,
      ca.ab_min        AS ab_min,
      ca.row_id        AS row_id
    FROM cand_area ca
    JOIN price_axis ax
      ON (ca.price_min IS NULL OR ca.price_min <  ax.pb_max)
     AND (ca.price_max IS NULL OR ca.price_max >= ax.pb_min)
    WHERE ca.price_min IS NOT NULL OR ca.price_max IS NOT NULL

    UNION ALL

    -- ② 価格希望なし(両側 NULL): 面積の NULL 枠と同じ考え方で、価格バケット NULL の
    --    別枠に1つだけ計上する。全バケットへ展開すると軸上の全セルを底上げして
    --    k 抑止の意味を薄め、「合算≠実人数」の歪みも最大化するため。
    SELECT
      ca.property_type AS property_type,
      NULL::integer    AS pb_min,
      NULL::integer    AS pb_max,
      ca.ab_min        AS ab_min,
      ca.row_id        AS row_id
    FROM cand_area ca
    WHERE ca.price_min IS NULL AND ca.price_max IS NULL
  )
  SELECT
    c.property_type,
    t.label_ja,
    c.pb_min,
    c.pb_max,
    c.ab_min,
    (c.ab_min + kc.area_step)::integer,      -- ab_min が NULL なら上限も NULL（NULL 枠）
    count(DISTINCT c.row_id)::integer
  FROM cells c
  JOIN public.property_types t ON t.code = c.property_type
  CROSS JOIN k_const kc
  GROUP BY c.property_type, t.label_ja, t.sort_order, c.pb_min, c.pb_max, c.ab_min, kc.area_step
  -- 裁定15/19: k 未満のセルは行ごと返さない。⛔ 生件数が 5 未満のセルの存在自体を出さない。
  HAVING count(DISTINCT c.row_id) >= (SELECT k FROM k_const)
  ORDER BY t.sort_order, c.pb_min NULLS LAST, c.ab_min NULLS LAST;
$$;

COMMENT ON FUNCTION public.get_buyer_match_cells(uuid, text, uuid, text, integer, integer) IS
  'PR-BM-4: 買い希望(lead_type=''buy'')の内訳カード。セル＝物件種別 × 価格帯(500万円刻み) × 専有面積帯(20㎡刻み・NULL は別枠)。'
  '⛔ セルの n を合算して総数としてはならない。1行が複数の価格バケットに現れる(希望レンジが重なるすべてのバケットに 1 ずつ計上する)。'
  '総数が要るときは get_buyer_match_summary の wide_count/near_count を使うこと。返り値に distinct_rows は含めない。'
  '⚠ スコープ違いの2回呼び出し(校区指定 と p_school_district_id IS NULL の市区町村スコープ)の差分から 5 未満の残余が推定され得る'
  '（get_school_district_heatmap と同性質）。UI 側で同一セッション内のスコープ切替を制限するかは BM-7 で判断する。'
  '裁定15の k 匿名化: 生件数が k=5 未満のセルは HAVING で行ごと落とす(存在自体を出さない)。k は関数内の k_const 1箇所。'
  '裁定14: 面積帯はセルの見出しにのみ使い絞り込みには使わない。1行1バケットで代表値は desired_floor_area_min、'
  '無ければ desired_floor_area_max、両方 NULL なら floor_area_bucket_min/max とも NULL の枠に入る。'
  '価格バケットは半開区間 [price_bucket_min, price_bucket_max)。軸はスコープ内の実データが張る範囲のみ生成し、'
  '価格希望が両側 NULL の行は price_bucket_min/max とも NULL の別枠に1つだけ計上する。'
  '引数: p_price_min/p_price_max は使わない(セルは全価格帯を返す・並びを R1/R3 と揃えるためシグネチャに残す)。'
  'p_school_district_id IS NULL なら市区町村スコープ / p_muni_code_5 IS NULL なら全市区町村 / p_property_type IS NULL なら全種別。'
  '裁定16: 直近12ヶ月。裁定17: 希望市区町村は COALESCE(desired_muni_code_5, dd.muni_code_5, sd.muni_code_5)、3つとも NULL の行は母数外。'
  'SECURITY INVOKER で RLS(org スコープ)が効くうえ、service_role の RLS バイパスに備え '
  'current_user_plan()=platinum・organization_id∈current_user_org_ids()・school_districts.is_public を関数側でも明示。';

REVOKE ALL ON FUNCTION public.get_buyer_match_cells(uuid, text, uuid, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_buyer_match_cells(uuid, text, uuid, text, integer, integer) FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_buyer_match_cells(uuid, text, uuid, text, integer, integer) TO authenticated;


-- =====================================================================
-- R3: get_buyer_match_rows — 社内向けの個票
-- =====================================================================
-- ⛔⛔ この RPC の結果は売主に見せない。社内画面専用（営業担当が自分の画面で見る用）。
--   k 抑止はかけない（自社の顧客情報を自社の担当者が見るだけのため）。
--   返す顧客情報は external_id / customer_name / assignee のみ＝CL-32 の
--   EXTRACT_KEYS(氏名のみ保持)の範囲内。電話・フリガナ・メール等は列ごと存在しない。
CREATE OR REPLACE FUNCTION public.get_buyer_match_rows(
  p_list_id            uuid,
  p_muni_code_5        text,
  p_school_district_id uuid,
  p_property_type      text,
  p_price_min          integer,
  p_price_max          integer
)
RETURNS TABLE (
  row_id                 uuid,
  external_id            text,
  customer_name          text,
  assignee               text,
  property_types         text[],
  price_min              integer,
  price_max              integer,
  desired_floor_area_min integer,
  desired_floor_area_max integer,
  inquiry_at             timestamptz,
  match_method           text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH buy_rows AS (
    SELECT
      r.id                     AS row_id,
      r.external_id            AS external_id,
      r.customer_name          AS customer_name,
      r.assignee               AS assignee,
      r.desired_muni_code_5    AS desired_muni_code_5,
      r.desired_floor_area_min AS desired_floor_area_min,
      r.desired_floor_area_max AS desired_floor_area_max,
      r.inquiry_at             AS inquiry_at
    FROM public.customer_list_rows r
    WHERE r.list_id = p_list_id
      AND r.deleted_at IS NULL
      AND r.lead_type = 'buy'
      AND r.inquiry_at IS NOT NULL
      AND r.inquiry_at >= now() - interval '12 months'
      AND public.current_user_plan() = 'platinum'
      AND r.organization_id IN (SELECT public.current_user_org_ids())
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
  scoped AS (
    SELECT DISTINCT ra.row_id
    FROM row_area ra
    JOIN area_known ak ON ak.row_id = ra.row_id
    WHERE ak.has_area
      AND (p_muni_code_5 IS NULL OR ra.muni_code_5 = p_muni_code_5)
  ),
  -- 校区スコープ＋その突合経路。1行に複数の school_type が並ぶ場合があるため1本に畳む。
  --   畳み込みは辞書順ではなく明示の優先順位（name_exact > name_normalized > その他）で、
  --   より確定的な経路を残す。p_school_district_id IS NULL のときは確定以外の
  --   match_method も現れ得るため、辞書順 min() だと 'ambiguous' が勝ってしまう。
  matched AS (
    SELECT
      ra.row_id,
      (array_agg(ra.match_method ORDER BY
        CASE ra.match_method
          WHEN 'name_exact'      THEN 1
          WHEN 'name_normalized' THEN 2
          ELSE 3
        END,
        ra.match_method))[1] AS match_method
    FROM row_area ra
    JOIN scoped s ON s.row_id = ra.row_id
    WHERE p_school_district_id IS NULL
       OR (ra.school_district_id = p_school_district_id
           AND ra.match_method IN ('name_exact', 'name_normalized'))
    GROUP BY ra.row_id
  ),
  -- 個票に出す行＝near_count と同じ条件（校区＋種別＋価格の重なり）で絞る。
  hit AS (
    SELECT DISTINCT m.row_id
    FROM matched m
    JOIN public.customer_list_row_property_types pt
      ON pt.row_id = m.row_id
    WHERE (p_property_type IS NULL OR pt.property_type = p_property_type)
      -- 裁定13/18: 価格の重なり。開区間・NULL は無制限。両側 NULL は該当扱い。
      AND (pt.price_min IS NULL OR p_price_max IS NULL OR pt.price_min <= p_price_max)
      AND (pt.price_max IS NULL OR p_price_min IS NULL OR pt.price_max >= p_price_min)
  ),
  -- 表示用の希望物件種別は「その顧客の希望すべて」を返す（p_property_type で絞らない）。
  --   price_min/price_max はその顧客の希望レンジの外側（最小の下限・最大の上限）。
  types AS (
    SELECT
      pt.row_id                                        AS row_id,
      array_agg(pt.property_type ORDER BY t.sort_order) AS property_types,
      min(pt.price_min)                                AS price_min,
      max(pt.price_max)                                AS price_max
    FROM public.customer_list_row_property_types pt
    JOIN public.property_types t ON t.code = pt.property_type
    JOIN hit h ON h.row_id = pt.row_id
    GROUP BY pt.row_id
  )
  SELECT
    b.row_id,
    b.external_id,
    b.customer_name,
    b.assignee,
    ty.property_types,
    ty.price_min,
    ty.price_max,
    b.desired_floor_area_min,
    b.desired_floor_area_max,
    b.inquiry_at,
    m.match_method
  FROM hit h
  JOIN buy_rows b ON b.row_id = h.row_id
  JOIN types    ty ON ty.row_id = h.row_id
  JOIN matched  m  ON m.row_id  = h.row_id
  ORDER BY b.inquiry_at DESC NULLS LAST, b.external_id;
$$;

COMMENT ON FUNCTION public.get_buyer_match_rows(uuid, text, uuid, text, integer, integer) IS
  'PR-BM-4: 買い希望の個票。⛔ 社内画面専用。売主への提示・PDF への出力を禁止する。'
  '⛔ この RPC の結果は売主に見せない（営業担当が自分の画面で見る用）。k 抑止はかけない'
  '（自社の顧客情報を自社の担当者が見るだけのため）。get_buyer_match_summary/get_buyer_match_cells と違い生件数・実在行を返す。'
  '対象は get_buyer_match_summary の near_count と同じ条件（校区＋物件種別＋価格の重なり・裁定13/18）。'
  '返す顧客情報は external_id / customer_name / assignee のみで CL-32 の EXTRACT_KEYS(氏名のみ保持)の範囲内。'
  '電話・フリガナ・メール等は customer_list_rows に列自体が存在しない。'
  'property_types はその顧客の希望物件種別すべて(p_property_type では絞らない・sort_order 順)、'
  'price_min/price_max はその顧客の希望レンジの外側(最小の下限・最大の上限)。'
  'match_method は校区の突合経路。行に複数の school_type がある場合は name_exact > name_normalized > その他 の優先順位で1本に畳む。'
  '並びは inquiry_at DESC NULLS LAST, external_id。裁定16: 直近12ヶ月。'
  'SECURITY INVOKER で RLS(org スコープ)が効くうえ、service_role の RLS バイパスに備え '
  'current_user_plan()=platinum・organization_id∈current_user_org_ids()・school_districts.is_public を関数側でも明示。';

REVOKE ALL ON FUNCTION public.get_buyer_match_rows(uuid, text, uuid, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_buyer_match_rows(uuid, text, uuid, text, integer, integer) FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_buyer_match_rows(uuid, text, uuid, text, integer, integer) TO authenticated;

COMMIT;

-- =====================================================================
-- ROLLBACK:
--   BEGIN;
--     DROP FUNCTION IF EXISTS public.get_buyer_match_summary(uuid, text, uuid, text, integer, integer);
--     DROP FUNCTION IF EXISTS public.get_buyer_match_cells(uuid, text, uuid, text, integer, integer);
--     DROP FUNCTION IF EXISTS public.get_buyer_match_rows(uuid, text, uuid, text, integer, integer);
--   COMMIT;
--   ※ 本 PR は新設のみ。既存関数の置き換えは行っていないため、DROP で適用前の状態に戻る。
--
-- 検証（適用後・PM 用）: scripts/sql/verify_bm4_buyer_match_rpcs.sql を実行する。
--   ・prosecdef=false(INVOKER) / provolatile='s'(STABLE) / proconfig に search_path=public,pg_temp
--   ・args が 3本とも (uuid, text, uuid, text, integer, integer) であること
--   ・proacl に service_role / anon / PUBLIC が含まれないこと（O109 の再発検知）
--   ・get_buyer_match_cells の返り列に distinct_rows が無いこと（裁定19）
--   ・k=5 抑止が効くこと（wide/near が 5 未満なら 0 かつ suppressed_*=true）
-- =====================================================================

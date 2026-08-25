-- =====================================================================
-- 20260825000100_add_get_school_district_heatmap.sql
-- M2-6a / PR-A-1: 校区ヒートマップ集計 RPC を1本新設。
--   顧客リスト(p_list_id)の反響行を校区に落とし込み、校区ごとの反響件数から
--   4段階(tier)の濃淡を返す。地図の校区ポリゴンに色を塗るための集計専用。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う(R7・D57)。
--   ※ supabase db push は恒久禁止。
--
-- 前提(PM が本番 DB で実測・git より優先):
--   - 既存作法(get_school_districts_geojson)= SECURITY INVOKER / stable。
--     ★本 RPC は geom を触らない純集計なので search_path = public, pg_temp が正。
--       PostGIS を使わないため extensions は足さない(2系統の使い分け)。
--   - RLS 実測:
--       school_districts … school_districts_select_public / SELECT / authenticated /
--                          USING (is_public = true)
--       customer_lists・customer_list_rows・customer_list_row_school_districts …
--                          SELECT は USING (organization_id IN (SELECT current_user_org_ids()))
--   - 組織スコープの正 = public.current_user_org_ids()(SECURITY DEFINER・SETOF uuid)
--   - プラン判定の正   = public.current_user_plan()(SECURITY DEFINER・text)
--   - 同名関数 get_school_district_heatmap は存在しない(pg_proc 全件で確認済み)。
--
-- 安全設計(絶対に変えない):
--   - SECURITY INVOKER: RLS(org スコープ / is_public)を関数越しにそのまま効かせる。
--     ⛔ SECURITY DEFINER 禁止。
--   - ★多層防御(service_role は RLS をバイパスするため、関数側でも明示的に絞る):
--       ・current_user_plan() = 'platinum'                     … 校区濃淡は Platinum 限定(SD-40)
--       ・r.organization_id IN (SELECT current_user_org_ids()) … 組織スコープ(RLS と重複だが必須)
--       ・d.is_public IS TRUE                                  … 公開校区のみ(RLS と重複だが必須)
--     ⛔ organization_id を引数で受け取らない(クライアント指定を許さない)。
--   - allowlist: p_school_type は 'elementary' / 'junior_high' のみ。それ以外は結果を返さない。
--     ★school_type で必ず絞る(絞らないと小学区＋中学区で二重計上する)。
--   - p_mode は SD-41(A案)による将来互換のための先置き。現時点で有効な値は 'sell' のみ。
--     'buy'/'gap' は lead_type 列の追加と desired_school の名寄せパイプラインが必要(未設計)。
--   - is_public の絞り込みはビン計算より前(counts CTE 内)で行う＝表示対象だけで分位を作る。
--   - k=5 抑止: HAVING count(*) >= 5(少数反響から個人が特定されるのを DB 層で防ぐ)。
--     ⛔ 生件数(count)を返す列は作らない(デバッグ用途でも不可)。
--   - tier = ceil(cume_dist() over (order by n) * 4)::smallint。
--     ★ntile は使わない。同件数が別の色に割れて「同じ件数なのに色が違う」が起きるため。
--       cume_dist なら同数は必ず同 tier になる。
--   - 権限: REVOKE ALL FROM PUBLIC, anon ＋ GRANT EXECUTE TO authenticated のみ。
--     ⛔ service_role には GRANT しない(RLS バイパス経路になるため。既存関数の作法とは
--        意図的に変えている。良かれと思って追加しないこと)。
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_school_district_heatmap(
  p_list_id uuid,
  p_school_type text DEFAULT 'elementary',
  p_mode text DEFAULT 'sell'
)
RETURNS TABLE (
  school_district_id uuid,
  school_name        text,
  muni_code_5        text,
  muni_name          text,
  tier               smallint,
  attribution_text   text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  -- (a)〜(d): 表示対象だけを集計してから (e) で分位を作る。
  WITH counts AS (
    SELECT
      d.id               AS school_district_id,
      d.school_name      AS school_name,
      d.muni_code_5      AS muni_code_5,
      d.muni_name        AS muni_name,
      d.attribution_text AS attribution_text,
      count(*)           AS n
    -- (a) 反響行: 当該リスト・非削除・確定・反響日あり・直近12ヶ月
    FROM public.customer_list_rows r
    -- (b) 突合結果: 同一行・当該校種・学区が特定できたものだけ(NULL は未突合)
    JOIN public.customer_list_row_school_districts l
      ON l.row_id = r.id
    -- (c) 校区: 公開校区のみ(is_public はビン計算より前＝この JOIN 条件で絞る)
    JOIN public.school_districts d
      ON d.id = l.school_district_id
    WHERE r.list_id = p_list_id
      AND r.deleted_at IS NULL
      AND r.match_status = 'confirmed'
      AND r.inquiry_at IS NOT NULL
      AND r.inquiry_at >= now() - interval '12 months'
      AND l.school_type = p_school_type
      AND l.school_district_id IS NOT NULL
      AND d.is_public IS TRUE
      -- allowlist 外(compulsory・NULL・想定外)は結果を返さない
      AND p_school_type IN ('elementary', 'junior_high')
      -- SD-41(A案): 現時点で有効なモードは 'sell' のみ('buy'/'gap' は未設計＝空)
      AND p_mode = 'sell'
      -- 多層防御(service_role の RLS バイパス経路を関数側で塞ぐ)
      AND public.current_user_plan() = 'platinum'
      AND r.organization_id IN (SELECT public.current_user_org_ids())
    -- (d) 校区ごとに集計し k=5 未満を抑止
    GROUP BY d.id, d.school_name, d.muni_code_5, d.muni_name, d.attribution_text
    HAVING count(*) >= 5
  )
  -- (e) 分位で tier 化 / (f) tier desc, muni_name, school_name
  SELECT
    c.school_district_id,
    c.school_name,
    c.muni_code_5,
    c.muni_name,
    ceil(cume_dist() OVER (ORDER BY c.n) * 4)::smallint AS tier,
    c.attribution_text
  FROM counts c
  ORDER BY tier DESC, c.muni_name, c.school_name;
$$;

COMMENT ON FUNCTION public.get_school_district_heatmap(uuid, text, text) IS
  'M2-6a/PR-A-1: 顧客リストの反響を校区ごとに集計し4段階(tier)の濃淡を返す。SECURITY INVOKER で RLS(org スコープ/is_public)が効くうえ、service_role の RLS バイパスに備え current_user_plan()=platinum(SD-40)・organization_id∈current_user_org_ids()・is_public を関数側でも明示。allowlist=elementary/junior_high(それ以外は空)。k=5 抑止(HAVING count>=5)・生件数は返さない。tier=ceil(cume_dist()*4)(ntile 不使用＝同数同色)。';

-- deny-by-default: PUBLIC/anon から実行権を剥奪し、authenticated のみに付与。
-- (新規 public RPC は anon にも自動で EXECUTE が付くため anon を明示的に REVOKE する)
-- ⛔ service_role には GRANT しない(RLS バイパス経路を作らない)。
REVOKE ALL ON FUNCTION public.get_school_district_heatmap(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_school_district_heatmap(uuid, text, text) TO authenticated;

COMMIT;

-- =====================================================================
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.get_school_district_heatmap(uuid, text, text);
--
-- 検証(適用後・PM 用): scripts/sql/verify_school_district_heatmap.sql を参照。
--   ・prosecdef=false(INVOKER) / proconfig に search_path=public,pg_temp
--   ・proacl に service_role が含まれないこと
--   ・返り値の列に生件数(count/n)が無いこと
-- =====================================================================

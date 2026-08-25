-- =====================================================================
-- 20260825000200_heatmap_add_muni_scope.sql
-- M2-6a / PR-D (SD-43): get_school_district_heatmap に p_muni_code_5 を追加し、
--   tier(濃淡)を「自治体ごと」の分位で計算するよう変更する。
--
-- 【背景】PM が本番 DB で実測:
--   同一リストに岡崎市＋安城市の反響が混在する場合、旧関数はリスト全体で分位を
--   割るため「安城の地図を開いても岡崎の件数を混ぜた色」が出ていた。
--   実測: 安城・桜井小16件はリスト全体分位で tier3 → 市内分位なら tier4、
--         岡崎・岩津小6件はリスト全体分位で tier1 → 市内分位なら tier2。
--   ★PARTITION BY c.muni_code_5 を常に付けることで、tier は常に
--     「その自治体の中での相対」という一貫した意味になる。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う(R7・D57)。
--   ※ supabase db push は恒久禁止。
--
-- ★引数が増えるため CREATE OR REPLACE では既存 (uuid, text, text) を置換できない。
--   DROP → CREATE が必要。既存 20260825000100 は本番適用済みのため変更しない。
--
-- 前提(20260825000100 と同一・PM 実測):
--   - SECURITY INVOKER / LANGUAGE sql / STABLE / search_path = public, pg_temp
--   - 組織スコープの正 = public.current_user_org_ids()
--   - プラン判定の正   = public.current_user_plan()
--
-- 安全設計(20260825000100 から一切変えない):
--   - SECURITY INVOKER で RLS(org スコープ / is_public)を関数越しにそのまま効かせる。
--     ⛔ SECURITY DEFINER 禁止。
--   - 多層防御: current_user_plan()='platinum'(SD-40) / organization_id ∈
--     current_user_org_ids() / is_public を関数側でも明示。
--     ⛔ organization_id を引数で受け取らない。
--   - allowlist: p_school_type は 'elementary' / 'junior_high' のみ。
--   - p_mode は SD-41(A案)の将来互換用。現時点で有効な値は 'sell' のみ。
--   - is_public の絞り込みはビン計算より前(counts CTE 内)。
--   - k=5 抑止: HAVING count(*) >= 5。⛔ 生件数(count/n)を返す列は作らない。
--   - tier = ceil(cume_dist() over (PARTITION BY muni_code_5 ORDER BY n) * 4)。
--     ★ntile は使わない(同数が別の色に割れるため。cume_dist なら同数同色)。
--   - 権限: REVOKE ALL FROM PUBLIC, anon + REVOKE service_role + GRANT authenticated のみ。
--     ★O109: Supabase の ALTER DEFAULT PRIVILEGES が新規 public 関数へ service_role の
--       EXECUTE を自動付与するため、REVOKE ALL ... FROM PUBLIC, anon では剥がれない。
--       service_role への REVOKE を必ず明示する(#74 と同じ理由)。
-- =====================================================================

BEGIN;

-- (a) 引数が増えるため CREATE OR REPLACE では置換不可。旧シグネチャを DROP する。
DROP FUNCTION IF EXISTS public.get_school_district_heatmap(uuid, text, text);

-- (b) 新シグネチャ(p_muni_code_5 を末尾に追加)。返り列・言語・揮発性・セキュリティ・
--     search_path は 20260825000100 と同一。
CREATE FUNCTION public.get_school_district_heatmap(
  p_list_id uuid,
  p_school_type text DEFAULT 'elementary',
  p_mode text DEFAULT 'sell',
  p_muni_code_5 text DEFAULT NULL
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
      -- ★PR-D(SD-43): 自治体スコープ。NULL なら全自治体、指定時はその市のみ。
      AND (p_muni_code_5 IS NULL OR d.muni_code_5 = p_muni_code_5)
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
  -- (e) 自治体ごとの分位で tier 化 / (f) muni_name でまとめ、その中で濃い順
  SELECT
    c.school_district_id,
    c.school_name,
    c.muni_code_5,
    c.muni_name,
    -- ★自治体内分位。p_muni_code_5 を渡さない呼び出しでも tier は
    --   「その自治体の中での相対」という一貫した意味になる。
    ceil(cume_dist() OVER (PARTITION BY c.muni_code_5 ORDER BY c.n) * 4)::smallint AS tier,
    c.attribution_text
  FROM counts c
  ORDER BY c.muni_name, tier DESC, c.school_name;
$$;

COMMENT ON FUNCTION public.get_school_district_heatmap(uuid, text, text, text) IS
  'M2-6a/PR-D(SD-43): 顧客リストの反響を校区ごとに集計し4段階(tier)の濃淡を返す。tier は自治体(muni_code_5)ごとの分位=ceil(cume_dist() over (PARTITION BY muni_code_5 ORDER BY n)*4)(ntile 不使用＝同数同色)。SECURITY INVOKER で RLS(org スコープ/is_public)が効くうえ、service_role の RLS バイパスに備え current_user_plan()=platinum(SD-40)・organization_id∈current_user_org_ids()・is_public を関数側でも明示。allowlist=elementary/junior_high(それ以外は空)。k=5 抑止(HAVING count>=5)・生件数は返さない。引数: p_mode=有効値は sell のみ(buy/gap は未設計＝空)。p_muni_code_5=NULL なら全自治体、指定時はその 5 桁市区町村コードのみに絞る。';

-- deny-by-default: PUBLIC/anon から実行権を剥奪し、authenticated のみに付与。
-- (新規 public RPC は anon にも自動で EXECUTE が付くため anon を明示的に REVOKE する)
REVOKE ALL ON FUNCTION public.get_school_district_heatmap(uuid, text, text, text) FROM PUBLIC, anon;
-- ★O109: Supabase の ALTER DEFAULT PRIVILEGES が新規 public 関数へ service_role の
--   EXECUTE を自動付与するため、明示的に剥がす(PUBLIC/anon の REVOKE では剥がれない・#74 と同理由)。
REVOKE ALL ON FUNCTION public.get_school_district_heatmap(uuid, text, text, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_school_district_heatmap(uuid, text, text, text) TO authenticated;

COMMIT;

-- =====================================================================
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.get_school_district_heatmap(uuid, text, text, text);
--   -- ※ 旧 (uuid, text, text) に戻す場合は 20260825000100 を再適用する。
--
-- 検証(適用後・PM 用): scripts/sql/verify_school_district_heatmap.sql を参照。
--   ・prosecdef=false(INVOKER) / proconfig に search_path=public,pg_temp
--   ・args が (uuid, text, text, text) であること
--   ・proacl に service_role が含まれないこと(O109 の再発検知)
--   ・返り値の列に生件数(count/n)が無いこと
-- =====================================================================

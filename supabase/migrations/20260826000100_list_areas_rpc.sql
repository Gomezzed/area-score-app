-- =====================================================================
-- 20260826000100_list_areas_rpc.sql
-- M2-6b / SD-44: 取込エリア一覧 RPC public.get_customer_list_areas を新設する。
--   顧客リストが「当たった」自治体の索引一覧（muni_code_5 / muni_name /
--   prefecture_name / has_school_districts）を返す。
--
-- 【設計の要旨】
--   - これは「索引」であって「集計」ではない（SD-45）。よって:
--     * ⛔ 12ヶ月フィルタ(inquiry_at)はかけない。
--     * ⛔ 生件数(COUNT/n)を返さない・SELECT リストにも返り列にも入れない。
--   - 同一自治体に複数行が当たっても 1 自治体 1 行にまとめる（GROUP BY で dedupe）。
--   - has_school_districts は公開校区(is_public IS TRUE)の EXISTS で導出する
--     （p_school_type で校種を絞る）。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う(R7・D57)。
--   ※ supabase db push は恒久禁止。
--
-- 前提(PM 実測・20260825000200 と同一の作法):
--   - SECURITY INVOKER / LANGUAGE sql / STABLE / search_path = public, pg_temp
--   - 組織スコープの正 = public.current_user_org_ids()
--   - プラン判定の正   = public.current_user_plan()
--   - 親キー: customer_list_rows.list_id（customer_list_id ではない）
--   - customer_list_rows.deleted_at あり / municipality_id(uuid,NULL可)→municipalities.id
--   - municipalities: city_code(text,5桁) / name(text) / prefecture_code(text)（県名列は無い）
--   - prefectures: code(text) / name(text)
--   - school_districts: muni_code_5(text) / school_type(text) / is_public(boolean)
--
-- 安全設計(20260825000200 から一切変えない方針):
--   - SECURITY INVOKER で RLS(customer_lists / customer_list_rows の org スコープ)を
--     関数越しにそのまま効かせる。⛔ SECURITY DEFINER 禁止。
--   - 多層防御(service_role の RLS バイパス経路を関数側でも塞ぐ・3条件):
--       * public.current_user_plan() = 'platinum'         (SD-40)
--       * l.organization_id IN (SELECT public.current_user_org_ids())
--       * school_districts 参照箇所は sd.is_public IS TRUE
--   - allowlist: p_school_type は 'elementary' / 'junior_high' のみ（それ以外は空）。
--   - ⚠ OUT パラメータ名(muni_code_5 等)と本文の列参照の衝突を避けるため、
--     SELECT/GROUP BY/ORDER BY は必ずテーブル別名で修飾し、出力列は AS で別名化する。
--   - 権限: REVOKE ALL FROM PUBLIC, anon, service_role + GRANT authenticated のみ。
--     ★O109: Supabase の ALTER DEFAULT PRIVILEGES が新規 public 関数へ service_role の
--       EXECUTE を自動付与する。REVOKE ... FROM service_role を必ず明示する(#74 と同理由)。
-- =====================================================================

BEGIN;

-- (a) 取込エリア一覧 RPC（新設）。
CREATE FUNCTION public.get_customer_list_areas(
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
  WHERE l.id = p_list_id
    -- 索引のため 12ヶ月フィルタ(inquiry_at)はかけない（SD-45）。
    AND r.deleted_at IS NULL
    AND r.municipality_id IS NOT NULL
    -- allowlist 外(compulsory・想定外)は結果を返さない
    AND p_school_type IN ('elementary', 'junior_high')
    -- 多層防御(service_role の RLS バイパス経路を関数側で塞ぐ)
    AND public.current_user_plan() = 'platinum'
    AND l.organization_id IN (SELECT public.current_user_org_ids())
  -- 同一自治体 1 行に dedupe（COUNT は取らない）。ORDER/GROUP は別名で修飾する。
  GROUP BY m.prefecture_code, m.city_code, m.name, pf.name
  ORDER BY m.prefecture_code, m.city_code;
$$;

COMMENT ON FUNCTION public.get_customer_list_areas(uuid, text) IS
  'M2-6b/SD-44: 顧客リストが当たった自治体の索引一覧を返す（集計ではなく索引＝生件数は返さない・12ヶ月フィルタなし SD-45）。返り列: muni_code_5(=municipalities.city_code 5桁)/muni_name/prefecture_name(prefectures を prefecture_code で LEFT JOIN)/has_school_districts(公開校区 is_public IS TRUE の EXISTS を p_school_type で絞って導出)。municipality_id(uuid) 経由で municipalities に結合し、r.deleted_at IS NULL かつ r.municipality_id IS NOT NULL のみ、同一自治体は 1 行に dedupe。SECURITY INVOKER で RLS(org スコープ)が効くうえ、service_role の RLS バイパスに備え current_user_plan()=platinum(SD-40)・l.organization_id∈current_user_org_ids()・is_public を関数側でも明示。allowlist=elementary/junior_high(それ以外は空)。引数: p_list_id=対象の customer_lists.id / p_school_type=has_school_districts 判定の校種(既定 elementary)。';

-- deny-by-default: PUBLIC/anon/service_role から実行権を剥奪し、authenticated のみに付与。
-- ★O109: 新規 public 関数へ service_role の EXECUTE が自動付与されるため、
--   「GRANT しない」だけでは剥がれない。service_role を明示的に REVOKE する(#74 と同理由)。
REVOKE ALL ON FUNCTION public.get_customer_list_areas(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_list_areas(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------
-- O109 の残件是正: 既存 RPC get_school_districts_geojson(text, text) の ACL から
--   service_role を剥がす（定義本体は変更しない・REVOKE 1 行のみ）。
--   ★この関数も新規 public 関数として作られた際に service_role の EXECUTE が
--     自動付与されている可能性があるため、明示的に剥がす。
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.get_school_districts_geojson(text, text) FROM service_role;

COMMIT;

-- =====================================================================
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.get_customer_list_areas(uuid, text);
--   -- ※ get_school_districts_geojson への REVOKE は権限のみの是正のため、
--   --    ロールバックは通常不要（戻す場合は当該関数の元 GRANT を再付与する）。
--
-- 検証(適用後・PM 用): 取込エリア一覧 RPC の宣言検証 SQL。
--   ※本セッションのスコープ上、検証 SQL は scripts/sql/ に配置できないため
--     _review に別ファイル(verify_list_areas_rpc.sql)として提出する。最終配置
--     (慣例では scripts/sql/verify_list_areas_rpc.sql)は PM/CC-B が行う。
--   確認観点: prosecdef=false(INVOKER) / provolatile='s'(STABLE) /
--     proconfig に search_path=public,pg_temp / args=(uuid,text) /
--     proacl に service_role・anon・PUBLIC が現れないこと(O109 再発検知) /
--     返り列に生件数(count/n)が無いこと / オーバーロード数=1 /
--     get_school_districts_geojson の ACL に service_role が居ないこと。
-- =====================================================================

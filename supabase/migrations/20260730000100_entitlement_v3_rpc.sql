-- =====================================================================
-- 20260730000100_entitlement_v3_rpc.sql
-- エンタイトルメント v3 / RPC のみ（2a・追加のみ・既存挙動不変）
--
-- expand-contract の "expand" フェーズ:
--   現行本番アプリ(main)はまだ census 3表を直読みしている。RLS 締め(2b)を
--   先に当てるとアプリの RPC 切替がデプロイされるまで free 画面が全件空になる
--   ブラックアウト窓が生じる。よって RPC は「追加のみ(additive)」で先行投入し、
--   アプリを RPC へ切替・デプロイした後に、別 migration(2b) で RLS を締める。
--
--   本 migration は関数の新規作成と EXECUTE 権限付与のみ。既存テーブル/ポリシー/
--   関数の挙動は一切変更しない（安全に何度でも再適用可）。
--
-- RPC 2本（SECURITY DEFINER / search_path 固定 / stable / EXECUTE は
--   authenticated のみ・anon には付与しない）:
--     - get_municipalities_gated(p_pref_code)    … 一覧＋ゲート済み数値
--     - get_population_history_gated(p_city_code) … 人口推移＋ゲート
--
-- Free 閲覧ルール v3（判定対象＝市区町村/区の数値。ロック行は数値を一切返さない）:
--   - 政令市がある道府県: 政令市本体（複数可）＋各政令市の人口上位3区 のみ実数。
--   - 東京都(13): 特別区(13101〜13123)の人口上位3区 のみ実数。市部・残る区はロック。
--   - それ以外の県: 人口上位3市区町村 のみ実数。
--   - free 以外（starter/standard/platinum）: 全行実数（locked=false）。
--   「人口上位」= 最新年(2025速報)人口の降順。
--
-- 設計注記:
--   - ロック判定の構造列 is_designated_city / parent_city_code は先行 migration
--     20260730000000 で前置き済み（東京特別区のみコード範囲 13101〜13123 で判定）。
--   - ロック行は数値・緯度経度をすべて NULL 化し、id・city_code・name・
--     prefecture_code・is_designated_city・parent_city_code・locked のみ返す。
--     （id はUIの key/選択に必要な非機微サロゲート。人口は復元不能）
--   - 並び順は真の pop_latest 降順（マスク前値）。ロック行も真の人口順を保つ。
-- =====================================================================

BEGIN;

-- =====================================================================
-- (A-1) get_municipalities_gated(p_pref_code text)
--   引数は2桁都道府県コードのみ受理。形式不正・存在しない値は空集合。
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_municipalities_gated(p_pref_code text)
RETURNS TABLE (
  id                        uuid,
  city_code                 text,
  prefecture_code           text,
  name                      text,
  lat                       double precision,
  lng                       double precision,
  station_passengers_total  bigint,
  pop_latest                bigint,
  pop_prev                  bigint,
  pop_prev2                 bigint,
  households_latest         bigint,
  delta                     bigint,
  delta_rate                double precision,
  is_designated_city        boolean,
  parent_city_code          text,
  locked                    boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH params AS (
    SELECT
      public.current_user_plan() AS plan,
      -- 政令市がある道府県か。15県ハードコードではなくデータ(is_designated_city)から導出し、
      -- 将来の政令市追加時の二重管理を防ぐ（東京は特別区が is_designated_city=false のため false）。
      EXISTS (
        SELECT 1 FROM public.municipalities
        WHERE prefecture_code = p_pref_code AND is_designated_city
      ) AS is_desig_pref,
      (p_pref_code = '13') AS is_tokyo
  ),
  base AS (
    SELECT
      mu.id, mu.city_code, mu.prefecture_code, mu.name, mu.lat, mu.lng,
      mu.station_passengers_total, mu.is_designated_city, mu.parent_city_code,
      ps25.population            AS pop_latest,
      ps20.population            AS pop_prev,
      ps15.population            AS pop_prev2,
      ps25.households            AS households_latest,
      ps25.population_delta       AS delta,
      ps25.population_delta_rate  AS delta_rate,
      (mu.city_code >= '13101' AND mu.city_code <= '13123') AS is_special_ward
    FROM public.municipalities mu
    LEFT JOIN public.population_stats ps25 ON ps25.municipality_id = mu.id AND ps25.year = 2025
    LEFT JOIN public.population_stats ps20 ON ps20.municipality_id = mu.id AND ps20.year = 2020
    LEFT JOIN public.population_stats ps15 ON ps15.municipality_id = mu.id AND ps15.year = 2015
    WHERE p_pref_code ~ '^[0-9]{2}$'
      AND mu.prefecture_code = p_pref_code
  ),
  ranked AS (
    SELECT b.*,
      -- 区の親グループ内 人口順位（政令市の区のみ）
      CASE WHEN b.parent_city_code IS NOT NULL
           THEN row_number() OVER (PARTITION BY b.parent_city_code
                                   ORDER BY b.pop_latest DESC NULLS LAST, b.city_code)
      END AS ward_rank,
      -- 東京特別区グループ内 人口順位
      CASE WHEN b.is_special_ward
           THEN row_number() OVER (PARTITION BY b.is_special_ward
                                   ORDER BY b.pop_latest DESC NULLS LAST, b.city_code)
      END AS sward_rank,
      -- 県内 人口順位（非政令市県で使用）
      row_number() OVER (ORDER BY b.pop_latest DESC NULLS LAST, b.city_code) AS pref_rank
    FROM base b
  ),
  decided AS (
    SELECT r.*,
      CASE
        WHEN (SELECT plan FROM params) <> 'free' THEN false
        WHEN (SELECT is_desig_pref FROM params) THEN
          NOT (r.is_designated_city OR (r.parent_city_code IS NOT NULL AND r.ward_rank <= 3))
        WHEN (SELECT is_tokyo FROM params) THEN
          NOT (r.is_special_ward AND r.sward_rank <= 3)
        ELSE
          NOT (r.pref_rank <= 3)
      END AS locked
    FROM ranked r
  )
  SELECT
    d.id,
    d.city_code,
    d.prefecture_code,
    d.name,
    CASE WHEN d.locked THEN NULL ELSE d.lat END,
    CASE WHEN d.locked THEN NULL ELSE d.lng END,
    CASE WHEN d.locked THEN NULL ELSE d.station_passengers_total END,
    CASE WHEN d.locked THEN NULL ELSE d.pop_latest END,
    CASE WHEN d.locked THEN NULL ELSE d.pop_prev END,
    CASE WHEN d.locked THEN NULL ELSE d.pop_prev2 END,
    CASE WHEN d.locked THEN NULL ELSE d.households_latest END,
    CASE WHEN d.locked THEN NULL ELSE d.delta END,
    CASE WHEN d.locked THEN NULL ELSE d.delta_rate END,
    d.is_designated_city,
    d.parent_city_code,
    d.locked
  FROM decided d
  ORDER BY d.pop_latest DESC NULLS LAST, d.city_code;
$$;

COMMENT ON FUNCTION public.get_municipalities_gated(text) IS
  'ダッシュボード一覧の唯一の取得口。Free 閲覧ルール v3 でロック行の数値を NULL 化して返す。'
  'current_user_plan()<>free は全行実数。SECURITY DEFINER のため RLS を跨いで census を集計する。';

-- Supabase の既定権限(ALTER DEFAULT PRIVILEGES)は新規関数の EXECUTE を anon にも
-- 自動付与するため、PUBLIC だけでなく anon からも明示的に剥奪する（anon 実行不可を保証）。
REVOKE ALL ON FUNCTION public.get_municipalities_gated(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_municipalities_gated(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_municipalities_gated(text) TO authenticated;

-- =====================================================================
-- (A-2) get_population_history_gated(p_city_code text)
--   人口推移グラフ用。5桁形式チェック。free でロック対象なら空集合。
--   ロック判定は get_municipalities_gated を単一の出所として再利用（ロジック二重化しない）。
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_population_history_gated(p_city_code text)
RETURNS TABLE (year int, population bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (e->>'year')::int AS year, (e->>'population')::bigint AS population
  FROM public.municipalities mu
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(mu.population_history, '[]'::jsonb)) AS e
  WHERE p_city_code ~ '^[0-9]{5}$'
    AND mu.city_code = p_city_code
    AND NOT EXISTS (
      SELECT 1
      FROM public.get_municipalities_gated(mu.prefecture_code) g
      WHERE g.city_code = mu.city_code AND g.locked
    )
  ORDER BY year;
$$;

COMMENT ON FUNCTION public.get_population_history_gated(text) IS
  '人口推移(2015〜2025)。free でロック対象コードなら空集合。ロック判定は get_municipalities_gated を再利用。';

REVOKE ALL ON FUNCTION public.get_population_history_gated(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_population_history_gated(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_population_history_gated(text) TO authenticated;

COMMIT;

-- =====================================================================
-- 検証クエリ（適用後 / SQL Editor は service_role 文脈＝current_user_plan()='free'）
-- ---------------------------------------------------------------------
-- (V5) RPC が存在し SECURITY DEFINER であること:
--   SELECT proname, prosecdef FROM pg_proc
--   WHERE proname IN ('get_municipalities_gated','get_population_history_gated');
--
-- (V6) EXECUTE 権限が authenticated のみ（anon 無し）:
--   SELECT p.proname, r.rolname
--   FROM pg_proc p
--   CROSS JOIN LATERAL aclexplode(p.proacl) a
--   JOIN pg_roles r ON r.oid = a.grantee
--   WHERE p.proname IN ('get_municipalities_gated','get_population_history_gated')
--     AND a.privilege_type='EXECUTE'
--   ORDER BY p.proname, r.rolname;
--   -- 期待: authenticated / service_role / postgres のみ（anon は無し）。
--   -- ※ service_role/postgres は信頼済みバックエンド/所有者ロール（current_user_plan と同様）。
--
-- ロールバック（逆SQL・追加のみのため関数削除で完全復帰）:
--   DROP FUNCTION IF EXISTS public.get_population_history_gated(text);
--   DROP FUNCTION IF EXISTS public.get_municipalities_gated(text);
-- =====================================================================

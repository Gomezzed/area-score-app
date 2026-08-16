-- =====================================================================
-- 20260816120000_step_m2_0_get_school_districts_geojson.sql
-- M2-0 / SD-29・SD-36: 学区ポリゴンを GeoJSON で返す RPC を1本新設。
--   引数 (p_muni_code_5, p_school_type) 単位のオンデマンド取得用
--   （学区図トグルON時に、選択中の市区町村×校種だけを取得する）。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う(R7・D57)。
--   ※ supabase db push は恒久禁止。
--
-- 前提:
--   - PostGIS は既に有効化済み（extensions スキーマ配置）。本 migration では有効化しない。
--   - geom は SRID 4326 / MultiPolygon（20260814110100 school_districts）。
--   - 公開判定の前置き（トグル disabled）は school_districts への列限定 SELECT で
--     別途行う（案(c)・migration 追加なし）。本 RPC は「取得」専用。
--
-- 安全設計（絶対に変えない）:
--   - SECURITY INVOKER: RLS school_districts_select_public を関数越しにそのまま効かせる。
--     ⛔ SECURITY DEFINER 禁止（is_public=false のポリゴンが漏れる）。
--   - allowlist: p_school_type は 'elementary' / 'junior_high' のみ。それ以外（compulsory 含む）
--     は問い合わせず空 FeatureCollection を返す（SD-29）。
--   - REVOKE ALL FROM PUBLIC, anon ＋ GRANT EXECUTE TO authenticated。
--   - ST_SimplifyPreserveTopology(geom, 0.0001) で簡素化（PM 実測: 鹿児島小 78件≈255KB）。
--   - SD-36: properties に school_name＋ラベル用代表点(label_lng/label_lat)を含める。
--     代表点は「簡素化後」ジオメトリの ST_PointOnSurface（描画する形状の内側に必ず載る）。
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_school_districts_geojson(
  p_muni_code_5 text,
  p_school_type text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT CASE
    -- allowlist 外（compulsory 含む・NULL・想定外文字列）は問い合わせず空を返す
    WHEN p_school_type NOT IN ('elementary', 'junior_high')
      THEN jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb)
    ELSE (
      SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', coalesce(jsonb_agg(f.feature), '[]'::jsonb)
      )
      FROM (
        SELECT jsonb_build_object(
          'type', 'Feature',
          'geometry', ST_AsGeoJSON(s.g)::jsonb,
          'properties', jsonb_build_object(
            'school_name',      sd.school_name,
            'school_type',      sd.school_type,
            'muni_code_5',      sd.muni_code_5,
            'attribution_text', sd.attribution_text,   -- NULL のまま返す（UI 側で "null" 描画を防ぐ・Q-C）
            'label_lng',        ST_X(ST_PointOnSurface(s.g)),
            'label_lat',        ST_Y(ST_PointOnSurface(s.g))
          )
        ) AS feature
        FROM public.school_districts sd
        -- 簡素化を1回だけ計算し AsGeoJSON と PointOnSurface で共用。
        -- 極小形状で簡素化が NULL 化した場合は原形へフォールバック（防御的）。
        CROSS JOIN LATERAL (
          SELECT coalesce(ST_SimplifyPreserveTopology(sd.geom, 0.0001), sd.geom) AS g
        ) s
        WHERE sd.muni_code_5 = p_muni_code_5
          AND sd.school_type = p_school_type
        -- ⛔ ここに is_public フィルタは書かない。
        --    RLS(school_districts_select_public)が INVOKER 実行で is_public=true のみに絞る
        --    ＝公開判定の単一の真実源。関数側で二重に書くと式が分岐して事故る。
      ) f
    )
  END;
$$;

COMMENT ON FUNCTION public.get_school_districts_geojson(text, text) IS
  'M2-0/SD-29: 学区ポリゴンを GeoJSON FeatureCollection(jsonb) で返す。SECURITY INVOKER で RLS(is_public=true)がそのまま効く。allowlist=elementary/junior_high（それ以外は空）。geom は ST_SimplifyPreserveTopology(geom,0.0001)。properties に school_name＋代表点(label_lng/label_lat)を含む(SD-36)。';

-- deny-by-default: PUBLIC/anon から実行権を剥奪し、authenticated のみに付与。
-- （新規 public RPC は anon にも自動で EXECUTE が付くため anon を明示的に REVOKE する）
REVOKE ALL ON FUNCTION public.get_school_districts_geojson(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_school_districts_geojson(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_school_districts_geojson(text, text) TO authenticated;

COMMIT;

-- =====================================================================
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.get_school_districts_geojson(text, text);
--
-- 検証（適用後・手動 / PM 用）:
--   -- 公開市×校種が返ること（豊田小 ≈75件 / 鹿児島小 ≈78件）:
--   SELECT jsonb_array_length(
--     public.get_school_districts_geojson('23211','elementary')->'features');
--   -- allowlist 外は空:
--   SELECT public.get_school_districts_geojson('23211','compulsory'); -- {"type":"FeatureCollection","features":[]}
--   -- 未公開市（例: 未許諾）は RLS により空:
--   SELECT jsonb_array_length(
--     public.get_school_districts_geojson('00000','elementary')->'features'); -- 0
--   -- 簡素化後のおおよそのサイズ（バイト）:
--   SELECT length(public.get_school_districts_geojson('46201','elementary')::text);
--   -- anon は EXECUTE 拒否:
--   SET ROLE anon;
--   SELECT public.get_school_districts_geojson('23211','elementary'); -- ERROR: permission denied for function
--   RESET ROLE;
-- =====================================================================

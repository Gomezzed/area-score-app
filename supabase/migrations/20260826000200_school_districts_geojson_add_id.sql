-- =====================================================================
-- 20260826000200_school_districts_geojson_add_id.sql
-- 学区ポリゴン GeoJSON の各 Feature の properties に 'id'(sd.id) を1キー追加する。
--   校区ヒートマップ(get_school_district_heatmap)が返す school_district_id(=school_districts.id)
--   とポリゴンを一意 ID で突合できるようにするための、properties への 'id' 追加のみの変更。
--   ⛔ 校区名で突合しない（同名校区があり得る）ため、突合キーは一意 ID とする。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う。
--   ※ supabase db push は恒久禁止。
--
-- 本 PR の変更範囲（これ以外は現行から1文字も変えない）:
--   - properties の jsonb_build_object に 'id' キーを1つ追加する。それだけ。
--
-- 安全設計（現行のまま・絶対に変えない）:
--   - SECURITY INVOKER: RLS school_districts_select_public(is_public=true)を
--     関数越しにそのまま効かせ、ライセンス未取得自治体の校区を除外する。
--     ⛔ SECURITY DEFINER 禁止（RLS を迂回して非公開自治体の校区が漏れる）。
--   - ⛔ 関数本体の WHERE 句に is_public を足さない（本 PR の変更は 'id' の1キーのみ）。
--   - ⛔ 引数名・引数順・返り値型・volatile・search_path を変えない。
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
            'id',               sd.id,
            'school_name',      sd.school_name,
            'school_type',      sd.school_type,
            'muni_code_5',      sd.muni_code_5,
            'attribution_text', sd.attribution_text,
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
  '学区ポリゴンを GeoJSON FeatureCollection(jsonb) で返す。SECURITY INVOKER で RLS(is_public=true)がそのまま効く。allowlist=elementary/junior_high（それ以外は空）。geom は ST_SimplifyPreserveTopology(geom,0.0001)。properties に id(校区の一意 ID)・school_name・代表点(label_lng/label_lat)を含む。';

-- deny-by-default: PUBLIC/anon/service_role から実行権を剥奪し、authenticated のみに付与。
REVOKE ALL ON FUNCTION public.get_school_districts_geojson(text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_school_districts_geojson(text, text)
  TO authenticated;

COMMIT;

-- =====================================================================
-- ROLLBACK:
--   本 migration は properties に 'id' を足す CREATE OR REPLACE。切り戻しは
--   直前定義(20260816120000)の CREATE OR REPLACE を再適用する（'id' キーの無い版へ戻す）。
--
-- 検証（適用後・手動 / PM 用）:
--   -- 検証 SQL: scripts/sql/verify_school_districts_geojson_id.sql
-- =====================================================================

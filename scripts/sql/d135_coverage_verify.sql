-- =====================================================================
-- scripts/sql/d135_coverage_verify.sql
-- D135 商圏カバレッジ拡張（代表点＋学校区ポリゴン）の投入前後 検収。
--   ⛔ SELECT のみ。DDL・DML（INSERT/UPDATE/DELETE）・BEGIN/COMMIT は書かない。
--   実行は PO/PM。投入の【前】と【後】に同じファイルを流し、件数差分で確認する。
--
-- D135 追加対象:
--   代表点(geo_reference_points): 愛知6市(23204/23213/23226/23228/23234/23238)
--     ＋ 名古屋16区(案A: 23101〜23116) ＋ 東郷町(23302)。
--   学校区(school_districts): 愛知6市のみ(23204/23213/23226/23228/23234/23238 × 小/中)。
--     名古屋(23100=PENDING)・豊川(23207=REJECTED)・東郷(台帳に行なし) は校区対象外。
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- A. 代表点 geo_reference_points
-- ─────────────────────────────────────────────────────────────────────

-- A-1) D135 追加対象の自治体別 × level 件数（投入【前】は 0 行、【後】に出現する）。
--      muni_name は municipalities.city_code と突き合わせて表示（名寄せ確認）。
SELECT g.muni_code_5, m.name AS muni_name, g.level, count(*) AS n
FROM public.geo_reference_points g
LEFT JOIN public.municipalities m ON m.city_code = g.muni_code_5
WHERE g.muni_code_5 IN (
  '23204','23213','23226','23228','23234','23238',        -- 愛知6市
  '23101','23102','23103','23104','23105','23106','23107','23108',
  '23109','23110','23111','23112','23113','23114','23115','23116', -- 名古屋16区
  '23302'                                                  -- 東郷町
)
GROUP BY g.muni_code_5, m.name, g.level
ORDER BY g.muni_code_5, g.level;

-- A-2) 名古屋16区（案A）が「区コードで」格納されていること＝23100（市コード）へ
--      丸められていないこと。23100 が 0 行、23101〜23116 が出現することを確認。
SELECT
  count(*) FILTER (WHERE muni_code_5 = '23100') AS nagoya_city_code_23100_should_be_0,
  count(DISTINCT muni_code_5) FILTER (WHERE muni_code_5 BETWEEN '23101' AND '23116') AS nagoya_wards_distinct_expect_16
FROM public.geo_reference_points
WHERE muni_code_5 = '23100' OR muni_code_5 BETWEEN '23101' AND '23116';

-- A-3) 東郷町(23302) の街区/町丁目が拾えたか（郡名表記に依存せず town レベルは必ず出る想定）。
--      block=0 のことはある（町村は都市計画区域外で街区点なし）。town>=1 を確認。
SELECT level, count(*) AS n
FROM public.geo_reference_points
WHERE muni_code_5 = '23302'
GROUP BY level
ORDER BY level;

-- A-4) 全体サマリ（投入前後の総数比較用）。既存8＋D135 で distinct が 8→（最大 8+6+16+1=31）。
SELECT count(*) AS total_points, count(DISTINCT muni_code_5) AS distinct_munis
FROM public.geo_reference_points;

-- A-5) SRID/幾何の健全性（既存点も含む・回帰確認）。
SELECT DISTINCT ST_SRID(geom) AS srid FROM public.geo_reference_points;

-- ─────────────────────────────────────────────────────────────────────
-- B. 学校区 school_districts（愛知6市の追加）
-- ─────────────────────────────────────────────────────────────────────

-- B-1) 台帳: D135 の6市が is_priority_target=true・CLEARED・attribution 有 であること。
--      （load_school_district_licenses.py 再投入【後】に true になる）。
SELECT muni_code_5, muni_name, school_type, license_status,
       is_priority_target,
       (attribution_text IS NOT NULL AND btrim(attribution_text) <> '') AS has_attribution,
       commercial_use
FROM public.school_district_licenses
WHERE source_version = 'R5'
  AND muni_code_5 IN ('23204','23213','23226','23228','23234','23238')
ORDER BY muni_code_5, school_type;

-- B-2) 台帳の is_priority_target=true 自治体数（既存11＋D135 6＝17 を期待）。
SELECT count(DISTINCT muni_code_5) AS priority_target_munis_expect_17
FROM public.school_district_licenses
WHERE source_version = 'R5' AND is_priority_target = true;

-- B-3) ポリゴン: 6市の 自治体 × school_type × is_public 件数（投入【後】に出現）。
--      CLEARED＋attribution 有のため is_public=true に追随することを確認。
SELECT muni_code_5, muni_name, school_type, license_status, is_public, count(*) AS n
FROM public.school_districts
WHERE muni_code_5 IN ('23204','23213','23226','23228','23234','23238')
GROUP BY muni_code_5, muni_name, school_type, license_status, is_public
ORDER BY muni_code_5, school_type;

-- B-4) 6市すべてが is_public=true で公開されること（is_public=false の行が無いこと）。
SELECT muni_code_5, muni_name, school_type, count(*) AS not_public_rows
FROM public.school_districts
WHERE muni_code_5 IN ('23204','23213','23226','23228','23234','23238')
  AND is_public = false
GROUP BY muni_code_5, muni_name, school_type
ORDER BY muni_code_5, school_type;   -- 期待: 0 行

-- B-5) 非対象の不変確認: 名古屋(23100)=PENDING・豊川(23207)=REJECTED は is_public=false のまま、
--      D135 で新たに公開されていないこと（校区対象外の温存）。
SELECT muni_code_5, muni_name, school_type, license_status, is_public, count(*) AS n
FROM public.school_districts
WHERE muni_code_5 IN ('23100','23207')
GROUP BY muni_code_5, muni_name, school_type, license_status, is_public
ORDER BY muni_code_5, school_type;

-- B-6) 幾何の健全性（6市分・回帰）。invalid=0 / SRID=4326 / MULTIPOLYGON のみ。
SELECT
  count(*) FILTER (WHERE NOT ST_IsValid(geom)) AS invalid_geom,
  count(DISTINCT ST_SRID(geom)) AS distinct_srid,
  count(DISTINCT GeometryType(geom)) AS distinct_geomtype
FROM public.school_districts
WHERE muni_code_5 IN ('23204','23213','23226','23228','23234','23238');

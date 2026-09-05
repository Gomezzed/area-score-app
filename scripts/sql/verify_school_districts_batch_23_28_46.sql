-- =====================================================================
-- scripts/sql/verify_school_districts_batch_23_28_46.sql
-- 学校区ポリゴン一括展開バッチ（案B: 愛知23 / 兵庫28 / 鹿児島46）の投入後 検証。
-- SELECT のみ（DDL・DML・BEGIN/COMMIT は一切含めない）。実行は PM/PO がコネクタで。
--
-- 前提:
--   - 対象選択は台帳 school_district_licenses.is_priority_target=true 由来（分岐 P）。
--   - source_version は全行 R5（他年度を混ぜない）。source_type は小=KSJ_A27_2023 / 中=KSJ_A32_2023。
--   - 座標系 EPSG:4326・MULTIPOLYGON。ライセンス列/is_public は台帳同期トリガー由来（本SQLは読むだけ）。
--   - 兵庫28 は入力ファイル到着後に追加投入する（本バッチ先行時は 28 の件数が 0 でも正常）。
-- 県別 = left(muni_code_5, 2)（'23'=愛知 / '28'=兵庫 / '46'=鹿児島）。
-- =====================================================================

-- ① 県別 × 校種別 の投入件数（1学校1行に統合済みの行数）。
SELECT left(muni_code_5, 2) AS pref_code,
       school_type,
       count(*) AS n_rows,
       count(DISTINCT muni_code_5) AS n_munis
FROM public.school_districts
WHERE left(muni_code_5, 2) IN ('23', '28', '46')
GROUP BY left(muni_code_5, 2), school_type
ORDER BY pref_code, school_type;

-- ② is_public の 県別 × 校種別 内訳（true/false それぞれの行数）。
--    CLEARED かつ attribution 有のみ true。REJECTED/PENDING は false（deny-by-default）。
SELECT left(muni_code_5, 2) AS pref_code,
       school_type,
       is_public,
       count(*) AS n_rows,
       count(DISTINCT muni_code_5) AS n_munis
FROM public.school_districts
WHERE left(muni_code_5, 2) IN ('23', '28', '46')
GROUP BY left(muni_code_5, 2), school_type, is_public
ORDER BY pref_code, school_type, is_public;

-- ③ source_version が R5 以外の行数（期待: 0）。他年度混入の検出。
SELECT count(*) AS non_r5_rows
FROM public.school_districts
WHERE source_version <> 'R5';

-- ③-2 参考: source_type × source_version の分布（期待: KSJ_A27_2023/KSJ_A32_2023 × R5 のみ）。
SELECT source_type, source_version, school_type, count(*) AS n_rows
FROM public.school_districts
GROUP BY source_type, source_version, school_type
ORDER BY source_type, source_version, school_type;

-- ④ 対象外コードの行数（期待: 0）。deny-by-default / REJECTED で投入してはならない自治体。
--    28201 姫路 / 28203 明石 / 28218 小野 / 46217 曽於 / 46218 霧島 / 28207 伊丹 / 28216 高砂。
SELECT muni_code_5, count(*) AS n_rows
FROM public.school_districts
WHERE muni_code_5 IN ('28201', '28203', '28218', '46217', '46218', '28207', '28216')
GROUP BY muni_code_5
ORDER BY muni_code_5;

-- ④-2 上の合計（1行で期待0を確認）。
SELECT count(*) AS excluded_code_rows
FROM public.school_districts
WHERE muni_code_5 IN ('28201', '28203', '28218', '46217', '46218', '28207', '28216');

-- ⑤ SRID が 4326 以外の行数（期待: 0）。
SELECT count(*) AS non_4326_rows
FROM public.school_districts
WHERE ST_SRID(geom) <> 4326;

-- ⑥ ST_IsValid(geom)=false の行数（期待: 0。ETL は ST_MakeValid 済み）。
SELECT count(*) AS invalid_geom_rows
FROM public.school_districts
WHERE NOT ST_IsValid(geom);

-- ⑥-2 参考: ジオメトリ型は MULTIPOLYGON のみであること。
SELECT DISTINCT GeometryType(geom) AS geom_type
FROM public.school_districts;

-- 補助) 自治体 × 校種別 の投入件数と公開状況（72対象自治体が出現するかの目視用）。
--       校種混在の 養父28222 / 奄美46222 / 姶良46225 は elementary が非出現(=台帳で非対象)であること。
SELECT muni_code_5, muni_name, school_type,
       license_status, is_public, count(*) AS n_rows
FROM public.school_districts
WHERE left(muni_code_5, 2) IN ('23', '28', '46')
GROUP BY muni_code_5, muni_name, school_type, license_status, is_public
ORDER BY muni_code_5, school_type;

-- =====================================================================
-- scripts/sql/step2_verify.sql
-- STEP2 学校区レイヤーの適用後 検証（SELECT のみ / DDL・DML は書かない）。
-- 実行はPO/PM。BEGIN/COMMIT・UPDATE・INSERT は含めない。
-- =====================================================================

-- 1) PostGIS の配置スキーマ確認（有効化はしない。配置の確認のみ）。
SELECT extname, extnamespace::regnamespace AS schema
FROM pg_extension
WHERE extname = 'postgis';

-- 2) school_districts の 自治体 × school_type × is_public 件数。
SELECT muni_code_5, muni_name, school_type, is_public, count(*) AS n
FROM public.school_districts
GROUP BY muni_code_5, muni_name, school_type, is_public
ORDER BY muni_code_5, school_type, is_public;

-- 3) 不正ジオメトリは 0 件であること。
SELECT count(*) AS invalid_geom_count
FROM public.school_districts
WHERE NOT ST_IsValid(geom);

-- 4) SRID は 4326 のみ。
SELECT DISTINCT ST_SRID(geom) AS srid
FROM public.school_districts;

-- 5) ジオメトリ型は MULTIPOLYGON のみ。
SELECT DISTINCT GeometryType(geom) AS geom_type
FROM public.school_districts;

-- 6) is_public = true の muni_name 一覧。
--    期待: 豊橋・岡崎・刈谷・豊田・安城・知立・高浜・鹿児島 の 8 市のみ。
--    （名古屋=PENDING / 一宮・豊川=REJECTED は含まれないこと）
SELECT DISTINCT muni_code_5, muni_name
FROM public.school_districts
WHERE is_public = true
ORDER BY muni_code_5;

-- 7) 名古屋(23100)・一宮(23203)・豊川(23207) が is_public = false であること。
SELECT muni_code_5, muni_name, school_type, license_status, is_public, count(*) AS n
FROM public.school_districts
WHERE muni_code_5 IN ('23100', '23203', '23207')
GROUP BY muni_code_5, muni_name, school_type, license_status, is_public
ORDER BY muni_code_5, school_type;

-- 8) 【SD-15 追随の確認手順（コメントのみ・実行しない）】
--    台帳の license_status を 1 件 CLEARED に変更したとき、AFTER UPDATE トリガー
--    (propagate_school_district_license) が school_districts のライセンス列を更新し、
--    生成列 is_public が true に追随することを確認する手順。
--    ※ 本ファイルは SELECT のみ。以下は PM が別途、監視付きで手動実行する想定。
--
--    -- (a) 変更前の状態を控える:
--    --   SELECT muni_code_5, school_type, license_status, is_public
--    --   FROM public.school_districts
--    --   WHERE muni_code_5 = '<対象>' AND school_type = 'elementary';
--    -- (b) 台帳を CLEARED に更新（例。実行はPM・要バックアップ）:
--    --   UPDATE public.school_district_licenses
--    --   SET license_status = 'CLEARED', attribution_text = coalesce(attribution_text, '出典：…')
--    --   WHERE source_version = 'R5' AND muni_code_5 = '<対象>' AND school_type = 'elementary';
--    -- (c) 追随を確認（is_public が true になること）:
--    --   SELECT muni_code_5, school_type, license_status, is_public
--    --   FROM public.school_districts
--    --   WHERE muni_code_5 = '<対象>' AND school_type = 'elementary';
--    -- (d) 検証後は (b) を元の値へ戻す（テストで公開状態を残さない）。

-- 9) 参考: 台帳 vs ポリゴンの license_status 突き合わせ（トリガーが写ったかの確認）。
--    ずれている行があれば source_version 不一致等を疑う。
SELECT sd.muni_code_5, sd.muni_name, sd.school_type,
       sd.license_status AS sd_status, l.license_status AS ledger_status,
       count(*) AS n
FROM public.school_districts sd
LEFT JOIN public.school_district_licenses l
  ON l.source_version = sd.source_version
 AND l.muni_code_5    = sd.muni_code_5
 AND l.school_type    = sd.school_type
GROUP BY sd.muni_code_5, sd.muni_name, sd.school_type, sd.license_status, l.license_status
ORDER BY sd.muni_code_5, sd.school_type;

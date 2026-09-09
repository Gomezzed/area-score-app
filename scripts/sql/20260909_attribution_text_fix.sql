-- =====================================================================
-- 20260909_attribution_text_fix.sql
-- 2026-09-09 に PM が Supabase コネクタで本番に実行済み。⛔ 再実行不要・記録用。
--
-- 経緯：O27（2026-08-16 確定）で出典文言を PK §2-2 の正文に定めたが、
--   DB 側の attribution_text が旧文言のままだった。9/8 の PDF 出力 PR で
--   発覚し、9/9 に PO 承認のうえ是正した。
--
-- 対象：public.school_district_licenses（正）。
--   ③ は public.school_districts 側の列の値を変えない UPDATE で、
--   licenses → districts の同期トリガー（trg_propagate_school_district_license /
--   supabase/migrations/20260814110100_step2_create_school_districts.sql）を
--   発火させる目的（PM 実行時の意図として付記）。
--
-- 実行結果（④の検証・PM 実測）：
--   is_public=true の校区で attribution_text が校種ごとに1種類のみ（混在なし）。
--     elementary  : 1,582 行
--     junior_high :   710 行
-- =====================================================================

-- ① 小学校区
UPDATE public.school_district_licenses
SET attribution_text = '出典：国土数値情報（小学校区データ）（国土交通省）（https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A27-2023.html）（2023年度）を加工して作成',
    updated_at = now()
WHERE license_status = 'CLEARED' AND school_type = 'elementary' AND source_version = 'R5';

-- ② 中学校区
UPDATE public.school_district_licenses
SET attribution_text = '出典：国土数値情報（中学校区データ）（国土交通省）（https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A32-2023.html）（2023年度）を加工して作成',
    updated_at = now()
WHERE license_status = 'CLEARED' AND school_type = 'junior_high' AND source_version = 'R5';

-- ③ school_districts 側へ同期（同期トリガーを発火させるための no-op UPDATE）
UPDATE public.school_districts SET source_version = source_version WHERE license_status = 'CLEARED';

-- ④ 検証（実行後・SELECT のみ）
SELECT school_type, attribution_text, count(*) AS n
FROM public.school_districts
WHERE is_public
GROUP BY 1,2 ORDER BY 1;

-- 実行結果: elementary 1,582 行／junior_high 710 行。いずれも校種ごとに attribution_text が
--   1種類のみ（混在なし）。

-- =====================================================================
-- scripts/sql/d135_coverage_rollback.sql
-- D135 商圏カバレッジ拡張の【自治体単位ロールバック】。
--
-- ⛔ 本ファイルは DML（DELETE/UPDATE）を含む。CC は実行しない・適用しない。
--    実行は PM が Supabase コネクタで、**バックアップ取得後**に監視付きで行う（R7・D57）。
--    まず §0 の件数確認を流し、想定件数と一致することを確かめてから §1〜§3 を流すこと。
--    各節は BEGIN 〜 （確認）〜 COMMIT/ROLLBACK の手動トランザクションで実行する想定。
--
-- 前提: D135 は schema 変更を伴わない（migration なし）。ロールバックも
--       「D135 で新規投入した自治体の行を DELETE」＋「台帳フラグを false へ戻す」だけ。
--       geo_reference_points / school_districts は UPSERT 投入のため、既存8市・既存11市の
--       行には一切触れない（下記 WHERE は D135 追加コードのみを対象にする）。
-- =====================================================================

-- ── §0. 事前件数確認（SELECT のみ）────────────────────────────────────
-- 代表点: D135 追加分の件数（この数が §1 の DELETE 予定数）。
SELECT muni_code_5, count(*) AS n
FROM public.geo_reference_points
WHERE muni_code_5 IN (
  '23204','23213','23226','23228','23234','23238',
  '23101','23102','23103','23104','23105','23106','23107','23108',
  '23109','23110','23111','23112','23113','23114','23115','23116',
  '23302'
)
GROUP BY muni_code_5 ORDER BY muni_code_5;

-- 学校区: D135 追加分（愛知6市）の件数（この数が §2 の DELETE 予定数）。
SELECT muni_code_5, school_type, count(*) AS n
FROM public.school_districts
WHERE muni_code_5 IN ('23204','23213','23226','23228','23234','23238')
GROUP BY muni_code_5, school_type ORDER BY muni_code_5, school_type;

-- ── §1. 代表点 geo_reference_points の削除（D135 追加の自治体のみ）──────
-- BEGIN;
-- DELETE FROM public.geo_reference_points
-- WHERE muni_code_5 IN (
--   '23204','23213','23226','23228','23234','23238',        -- 愛知6市
--   '23101','23102','23103','23104','23105','23106','23107','23108',
--   '23109','23110','23111','23112','23113','23114','23115','23116', -- 名古屋16区
--   '23302'                                                  -- 東郷町
-- );
-- -- 確認: 上の §0 の合計と一致するか。問題なければ COMMIT、異常なら ROLLBACK。
-- COMMIT;

-- ── §2. 学校区 school_districts の削除（D135 追加の愛知6市のみ）─────────
-- BEGIN;
-- DELETE FROM public.school_districts
-- WHERE muni_code_5 IN ('23204','23213','23226','23228','23234','23238');
-- COMMIT;

-- ── §3. 台帳フラグの復元（is_priority_target を false へ戻す）───────────
-- 学校区を再投入させないため、6市の is_priority_target を元の false に戻す。
-- ※ 恒久的には docs/school_district_licenses_r5.csv の該当12行を git で戻し、
--    load_school_district_licenses.py を再実行するのが正。下記は DB 直接復元の即時手当。
-- BEGIN;
-- UPDATE public.school_district_licenses
-- SET is_priority_target = false
-- WHERE source_version = 'R5'
--   AND muni_code_5 IN ('23204','23213','23226','23228','23234','23238');
-- -- 期待: 12 行更新。
-- COMMIT;

-- ── §4. 事後確認（SELECT のみ・§1〜§3 実行後）────────────────────────
SELECT 'geo' AS tbl, count(*) AS remaining
FROM public.geo_reference_points
WHERE muni_code_5 IN (
  '23204','23213','23226','23228','23234','23238',
  '23101','23102','23103','23104','23105','23106','23107','23108',
  '23109','23110','23111','23112','23113','23114','23115','23116','23302')
UNION ALL
SELECT 'sd', count(*)
FROM public.school_districts
WHERE muni_code_5 IN ('23204','23213','23226','23228','23234','23238');
-- 期待: どちらも 0。

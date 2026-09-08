-- =====================================================================
-- 20260909000100_bm_desired_area.sql
-- 購入希望マッチ（BM）PR-BM-2 / c0: customer_list_rows に希望面積 4 列を追加する。
--   決定: Vault 2026-09-03_Decision_購入希望マッチ設計（仮番 -bm-）。
--   ⚠ -bm- は「仮番」。本 migration で仮番を新設・変更・採番しない。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う（R7・D57）。
--   ※ supabase db push は恒久禁止。
--
-- 本 migration が作るもの:
--   (1) customer_list_rows.desired_floor_area_min / _max … 希望専有面積（㎡・整数）
--   (2) customer_list_rows.desired_land_area_min  / _max … 希望土地面積（㎡・整数）
--   (3) 上記 2 組の範囲 CHECK（>=0 かつ min <= max）
--
-- 入力元（ハウスドゥ形式 174 列・列番号は 1 始まり。実装は index -1 で読む）:
--   列111/112『マッチング専有面積下限／上限』→ desired_floor_area_min / _max
--   列109/110『マッチング土地面積下限／上限』→ desired_land_area_min  / _max
--
-- ⛔ 本 migration に含めないもの:
--   価格（customer_list_row_property_types.price_min/max・BM-1 で作成済み）・
--   lead_type（BM-1 で作成済み）・取込ロジック・RPC・API・UI。
--   RLS ポリシー / GRANT は customer_list_rows の既存 4 本を一切変更しない
--   （列追加のみ。既存ポリシーは列を限定していないため新列にもそのまま効く）。
--
-- 前提（BM-1 適用後・PM 実測 2026/9/9）:
--   - 台帳最新は 20260908000200。本ファイルはその後ろに採番（20260909000050 は
--     権限追認のため実 DB へは 9/9 適用済み）。
--   - customer_list_rows の CHECK は customer_list_rows_lead_type_check /
--     customer_list_rows_match_status_check の 2 本。面積系の列・制約は未存在。
--
-- 単位について（原則1: 確定と推定を混ぜない）:
--   値は CSV の記載値をそのまま整数化した㎡。⛔ 坪→㎡ の換算は取込側で行わない
--   （換算＝推定を混ぜることになるため、パース不能な書式は NULL + reason で残す）。
-- =====================================================================

BEGIN;


-- =====================================================================
-- (1)(2) 希望面積 4 列
-- =====================================================================
ALTER TABLE public.customer_list_rows
  ADD COLUMN IF NOT EXISTS desired_floor_area_min integer,
  ADD COLUMN IF NOT EXISTS desired_floor_area_max integer,
  ADD COLUMN IF NOT EXISTS desired_land_area_min  integer,
  ADD COLUMN IF NOT EXISTS desired_land_area_max  integer;


-- =====================================================================
-- (3) 範囲 CHECK
-- =====================================================================
-- NULL は「未入力」として許す（下限だけ・上限だけの指定も実データに存在しうる）。
-- 両方が入っているときだけ min <= max を課す。
ALTER TABLE public.customer_list_rows
  ADD CONSTRAINT customer_list_rows_desired_floor_area_check CHECK (
    (desired_floor_area_min IS NULL OR desired_floor_area_min >= 0) AND
    (desired_floor_area_max IS NULL OR desired_floor_area_max >= 0) AND
    (desired_floor_area_min IS NULL OR desired_floor_area_max IS NULL OR desired_floor_area_min <= desired_floor_area_max)),
  ADD CONSTRAINT customer_list_rows_desired_land_area_check CHECK (
    (desired_land_area_min IS NULL OR desired_land_area_min >= 0) AND
    (desired_land_area_max IS NULL OR desired_land_area_max >= 0) AND
    (desired_land_area_min IS NULL OR desired_land_area_max IS NULL OR desired_land_area_min <= desired_land_area_max));


COMMENT ON COLUMN public.customer_list_rows.desired_floor_area_min IS
  '希望専有面積の下限（㎡・整数）。ハウスドゥ形式 列111『マッチング専有面積下限』。BM-2（仮番 -bm-）。';
COMMENT ON COLUMN public.customer_list_rows.desired_floor_area_max IS
  '希望専有面積の上限（㎡・整数）。ハウスドゥ形式 列112『マッチング専有面積上限』。BM-2（仮番 -bm-）。';
COMMENT ON COLUMN public.customer_list_rows.desired_land_area_min IS
  '希望土地面積の下限（㎡・整数）。ハウスドゥ形式 列109『マッチング土地面積下限』。BM-2（仮番 -bm-）。';
COMMENT ON COLUMN public.customer_list_rows.desired_land_area_max IS
  '希望土地面積の上限（㎡・整数）。ハウスドゥ形式 列110『マッチング土地面積上限』。BM-2（仮番 -bm-）。';

COMMIT;


-- =====================================================================
-- ロールバック SQL（適用を取り消す場合・PM が手動実行）:
--   BEGIN;
--   ALTER TABLE public.customer_list_rows
--     DROP CONSTRAINT IF EXISTS customer_list_rows_desired_floor_area_check,
--     DROP CONSTRAINT IF EXISTS customer_list_rows_desired_land_area_check;
--   ALTER TABLE public.customer_list_rows
--     DROP COLUMN IF EXISTS desired_floor_area_min,   -- ⚠ 取込済みの希望面積も消える
--     DROP COLUMN IF EXISTS desired_floor_area_max,
--     DROP COLUMN IF EXISTS desired_land_area_min,
--     DROP COLUMN IF EXISTS desired_land_area_max;
--   COMMIT;
-- =====================================================================


-- =====================================================================
-- 適用後の確認 SQL（PM が実行）:
--
-- ── ① 列が 4 本・integer・NULL 可で増えていること ─────────────────────
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='customer_list_rows'
--     AND column_name LIKE 'desired_%_area_%' ORDER BY 1;
--   -- 期待: desired_floor_area_max / _min / desired_land_area_max / _min の 4 行。
--   --       いずれも data_type=integer・is_nullable=YES。
--
-- ── ② CHECK 制約が 4 本になっていること ─────────────────────────────
--   SELECT conname FROM pg_constraint
--   WHERE conrelid='public.customer_list_rows'::regclass AND contype='c' ORDER BY 1;
--   -- 期待: customer_list_rows_desired_floor_area_check /
--   --       customer_list_rows_desired_land_area_check /
--   --       customer_list_rows_lead_type_check /
--   --       customer_list_rows_match_status_check の 4 本。
--
-- ── ③ RLS ポリシー 4 本が不変であること ─────────────────────────────
--   SELECT policyname, cmd, qual, with_check FROM pg_policies
--   WHERE schemaname='public' AND tablename='customer_list_rows' ORDER BY cmd;
--   -- 期待: clr_select_org / clr_insert_org / clr_update_org / clr_delete_org が
--   --       一字一句同じ（本 migration はポリシーを触らない）。
--
-- ── ④ 範囲 CHECK が効くこと（任意・ロールバック可能なトランザクションで）───
--   BEGIN;
--     UPDATE public.customer_list_rows
--       SET desired_land_area_min = 100, desired_land_area_max = 50
--       WHERE id = (SELECT id FROM public.customer_list_rows LIMIT 1);
--     -- 期待: customer_list_rows_desired_land_area_check 違反で失敗する。
--   ROLLBACK;
-- =====================================================================

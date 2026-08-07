-- =====================================================================
-- 20260808000100_harden_customer_list_view_grants.sql
--
-- 【プロベナンス回収 / 適用済み】
--   本 SQL は 2026-08-08 のタイムアウト・ホットフィックス調査中に、PO が本番
--   （Supabase コネクタ）で **すでに手動適用済み** のもの。リポジトリに migration
--   ファイルとして記録し、コード=DB の乖離（#16 の反省）を残さないための回収記録。
--
-- 目的:
--   ビュー public.customer_list_town_latest の付与を anon から剥奪し、authenticated
--   にのみ SELECT を残す（機密＝platinum 限定の町域データの多層防御）。
--   行の可視性は基表 town_monthly_metrics の RLS(security_invoker) が担う。
--
-- ⚠ 冪等・意味不変。既に適用済みのため、他環境での再適用も安全（REVOKE/GRANT のみ）。
-- =====================================================================

BEGIN;

REVOKE ALL    ON public.customer_list_town_latest FROM anon, authenticated;
GRANT  SELECT ON public.customer_list_town_latest TO   authenticated;

COMMIT;

-- 適用記録: 2026-08-08 本番(area-score-app / ref bstohiamtnlgcjulgedy) に PO が手動適用済み。
--            本ファイルは事後のプロベナンス回収（コード⇔DB 整合の担保）。

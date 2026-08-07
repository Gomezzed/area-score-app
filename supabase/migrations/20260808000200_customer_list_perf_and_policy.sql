-- =====================================================================
-- 20260808000200_customer_list_perf_and_policy.sql
--
-- 【作成のみ・DB 適用は禁止（PR マージ後に PO が適用）】
--
-- 目的（顧客リスト連携の突合全滅バグ = statement timeout のホットフィックス）:
--   根本原因（PO が本番ログ/DB で実証済み）:
--     import 時の突合インデックス構築が customer_list_town_latest を無条件で
--     全取得し、基表 town_monthly_metrics 約19.4万行スキャン × RLS
--     current_user_plan() の「行ごと評価」により authenticated の
--     statement_timeout(8s) を超過 → 57014（canceling statement due to timeout）。
--
--   本 migration の対策（DB 側・アプリ側の .in() 絞り込みと合わせて二段構え）:
--     1) (municipality_id, as_of) の複合インデックス。ビューの
--        (municipality_id, max(as_of)) 抽出と .in() 絞り込みを索引で効かせる。
--        ※ 既存の同名インデックスがあれば IF NOT EXISTS で no-op（冪等）。
--     2) RLS ポリシーの「初期計画化(initplan)」。USING 内の関数呼び出しを
--        (select public.current_user_plan()) に包むことで、行ごと評価から
--        クエリごと1回評価へ最適化する（意味は同一・platinum のみ SELECT 可）。
-- =====================================================================

BEGIN;

-- 1) 複合インデックス（自治体×時点）。ビュー抽出・.in() 絞り込みを索引化。
CREATE INDEX IF NOT EXISTS town_monthly_metrics_muni_asof_idx
  ON public.town_monthly_metrics (municipality_id, as_of);

-- 2) RLS ポリシーの初期計画化（意味は同一・行ごと評価 → クエリごと評価）。
DROP POLICY IF EXISTS "platinum reads town metrics" ON public.town_monthly_metrics;
CREATE POLICY "platinum reads town metrics" ON public.town_monthly_metrics
  FOR SELECT
  TO authenticated
  USING ((select public.current_user_plan()) = 'platinum');

COMMENT ON POLICY "platinum reads town metrics" ON public.town_monthly_metrics IS
  'platinum のみ SELECT 可。USING を (select ...) で initplan 化し行ごと評価を回避。';

COMMIT;

-- =====================================================================
-- 検証クエリ（適用後に手動実行）
--   -- インデックス存在:
--   SELECT indexname FROM pg_indexes
--   WHERE schemaname='public' AND tablename='town_monthly_metrics'
--     AND indexname='town_monthly_metrics_muni_asof_idx';
--   -- ポリシー定義（USING に (select current_user_plan()) が入っていること）:
--   SELECT policyname, qual FROM pg_policies
--   WHERE schemaname='public' AND tablename='town_monthly_metrics'
--     AND policyname='platinum reads town metrics';
--   -- 実行計画の確認（platinum ユーザーで岡崎を .in() 絞り込み時に索引が効くこと）:
--   -- EXPLAIN ANALYZE SELECT * FROM public.customer_list_town_latest
--   --   WHERE municipality_id = '<okazaki-uuid>';
-- =====================================================================

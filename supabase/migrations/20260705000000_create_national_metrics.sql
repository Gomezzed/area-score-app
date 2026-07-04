-- =====================================================================
-- 全国系メトリクス（金利・家賃指数等）
-- ---------------------------------------------------------------------
-- 原則: confirmed(公表事実) と reference(参考・当社集計) を value_type で分離する。
-- グレイン: (metric_type, value_type, series, year, month)
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.national_metrics (
  metric_type   TEXT NOT NULL CHECK (metric_type IN ('interest_rate','rent_index')),
  value_type    TEXT NOT NULL CHECK (value_type IN ('confirmed','reference')),
  series        TEXT NOT NULL DEFAULT '',
  year          INTEGER NOT NULL,
  month         INTEGER CHECK (month BETWEEN 1 AND 12),
  value         NUMERIC NOT NULL,
  unit          TEXT NOT NULL,
  source        TEXT NOT NULL,
  source_detail JSONB,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_national_metrics_period UNIQUE NULLS NOT DISTINCT
    (metric_type, value_type, series, year, month)
);

CREATE INDEX IF NOT EXISTS idx_nm_type_series_year
  ON public.national_metrics (metric_type, value_type, series, year);

ALTER TABLE public.national_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nm_read_standard_plus" ON public.national_metrics;
CREATE POLICY "nm_read_standard_plus"
  ON public.national_metrics
  FOR SELECT
  TO authenticated
  USING (public.current_user_plan() IN ('standard','platinum'));

DROP POLICY IF EXISTS "nm_service_role_all" ON public.national_metrics;
CREATE POLICY "nm_service_role_all"
  ON public.national_metrics
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.national_metrics IS
  '全国単位の時系列メトリクス。confirmed/reference は value_type で分離する。'
  'グレイン=(metric_type,value_type,series,year,month)。RLS: standard+ SELECT。';

COMMENT ON POLICY "nm_read_standard_plus" ON public.national_metrics IS
  'standard/platinum プランのみ SELECT 可。anon/非standard+ authenticated は 0 行。';

-- テーブル権限の最小化（多層防御）。
-- 行の可視性は RLS が制御するため、anon は 0 行、非standard+ authenticated も 0 行。
-- 書き込みは service_role のみ。
REVOKE ALL    ON public.national_metrics FROM anon, authenticated;
GRANT  SELECT ON public.national_metrics TO   anon, authenticated;

COMMIT;

-- =====================================================================
-- 検証クエリ（適用後に手動実行）
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.national_metrics'::regclass;
--   SELECT policyname, roles, cmd, qual
--   FROM pg_policies WHERE schemaname='public' AND tablename='national_metrics';
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint WHERE conrelid='public.national_metrics'::regclass;
-- =====================================================================

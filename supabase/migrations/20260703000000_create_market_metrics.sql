-- =====================================================================
-- 相場・公示価格・路線価・金利・家賃の統合メトリクス
-- ---------------------------------------------------------------------
-- 原則: confirmed(公表事実) と reference(参考・当社集計) を value_type で分離する。
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS market_metrics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  muni_code     TEXT NOT NULL REFERENCES municipalities(city_code)
                CHECK (muni_code ~ '^[0-9]{5}$'),
  metric_type   TEXT NOT NULL CHECK (metric_type IN
                  ('trade_price','official_land_price','rosenka','interest_rate','rent')),
  value_type    TEXT NOT NULL CHECK (value_type IN ('confirmed','reference')),
  property_type TEXT NOT NULL DEFAULT '',
  year          INTEGER NOT NULL,
  quarter       INTEGER CHECK (quarter BETWEEN 1 AND 4),
  value         NUMERIC NOT NULL,
  unit          TEXT NOT NULL,
  sample_count  INTEGER CHECK (sample_count IS NULL OR sample_count >= 0),
  source        TEXT NOT NULL,
  source_detail JSONB,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_market_metrics_period UNIQUE NULLS NOT DISTINCT
    (muni_code, metric_type, value_type, property_type, year, quarter)
);

CREATE INDEX IF NOT EXISTS idx_mm_muni_year ON market_metrics (muni_code, year);
CREATE INDEX IF NOT EXISTS idx_mm_type      ON market_metrics (metric_type, value_type);

ALTER TABLE market_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mm_read_standard_plus" ON market_metrics;
CREATE POLICY "mm_read_standard_plus"
  ON market_metrics FOR SELECT
  TO authenticated
  USING (public.current_user_plan() IN ('standard','platinum'));

DROP POLICY IF EXISTS "mm_service_role_all" ON market_metrics;
CREATE POLICY "mm_service_role_all"
  ON market_metrics FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

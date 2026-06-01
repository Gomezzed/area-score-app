-- Migration: Cap score at 100 using LEAST()
-- Apply via Supabase Dashboard → SQL Editor

DROP INDEX IF EXISTS idx_areas_score;
DROP INDEX IF EXISTS idx_areas_tier;

ALTER TABLE areas DROP COLUMN IF EXISTS score;
ALTER TABLE areas DROP COLUMN IF EXISTS tier;

ALTER TABLE areas ADD COLUMN score FLOAT GENERATED ALWAYS AS (
  LEAST(
    transaction_count * 0.4 +
    population_delta  * 0.3 +
    avg_price_level   * 0.3,
    100.0
  )
) STORED;

ALTER TABLE areas ADD COLUMN tier TEXT GENERATED ALWAYS AS (
  CASE
    WHEN LEAST(transaction_count * 0.4 + population_delta * 0.3 + avg_price_level * 0.3, 100.0) >= 70 THEN 'A'
    WHEN LEAST(transaction_count * 0.4 + population_delta * 0.3 + avg_price_level * 0.3, 100.0) >= 40 THEN 'B'
    ELSE 'C'
  END
) STORED;

CREATE INDEX IF NOT EXISTS idx_areas_tier  ON areas(tier);
CREATE INDEX IF NOT EXISTS idx_areas_score ON areas(score DESC);

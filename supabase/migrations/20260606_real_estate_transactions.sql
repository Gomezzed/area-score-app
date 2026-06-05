-- ============================================================
-- 不動産取引データ（国土交通省 不動産取引価格情報）
--   中古マンション等の成約件数・平均価格・㎡単価を
--   市区町村 × 年 × 四半期 で集計して保持する。
-- ============================================================

CREATE TABLE IF NOT EXISTS real_estate_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id   UUID REFERENCES municipalities(id),
  prefecture_code   TEXT NOT NULL,
  city_code         TEXT NOT NULL,
  year              INTEGER NOT NULL,
  quarter           INTEGER NOT NULL,
  transaction_count INTEGER DEFAULT 0,
  avg_price_man_yen NUMERIC,
  avg_price_per_sqm NUMERIC,
  avg_area_sqm      NUMERIC,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ret_prefecture ON real_estate_transactions(prefecture_code);
CREATE INDEX IF NOT EXISTS idx_ret_city ON real_estate_transactions(city_code);
CREATE INDEX IF NOT EXISTS idx_ret_year ON real_estate_transactions(year);

-- (city_code, year, quarter) を一意にして upsert 可能にする
CREATE UNIQUE INDEX IF NOT EXISTS idx_ret_city_year_quarter
  ON real_estate_transactions(city_code, year, quarter);

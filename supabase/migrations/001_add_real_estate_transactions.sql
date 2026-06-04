-- 不動産取引価格テーブル
-- 出典: 国土交通省 不動産取引価格情報 https://www.land.mlit.go.jp/webland/
CREATE TABLE IF NOT EXISTS real_estate_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prefecture_code TEXT NOT NULL,
  city_code       TEXT NOT NULL DEFAULT '',
  city_name       TEXT NOT NULL,
  year            INTEGER NOT NULL,
  quarter         INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  price_per_sqm   NUMERIC,        -- 円/㎡
  total_price     NUMERIC,        -- 万円
  area_sqm        NUMERIC,        -- ㎡
  property_type   TEXT NOT NULL DEFAULT '中古マンション等',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ret_pref_year  ON real_estate_transactions(prefecture_code, year);
CREATE INDEX IF NOT EXISTS idx_ret_city_year  ON real_estate_transactions(city_name, year);

ALTER TABLE real_estate_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ret_read_authenticated"
  ON real_estate_transactions FOR SELECT
  USING (auth.role() = 'authenticated');

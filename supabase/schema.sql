-- ============================================
-- エリアスコア分析ダッシュボード Supabase スキーマ
-- ============================================

-- 都市マスタ
CREATE TABLE IF NOT EXISTS cities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,          -- 例: '鹿児島', '仙台', '愛知'
  name_en     TEXT NOT NULL,          -- 例: 'kagoshima'
  center_lat  FLOAT NOT NULL,
  center_lng  FLOAT NOT NULL,
  zoom_level  INT NOT NULL DEFAULT 12,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- エリア（町丁目・区単位）
CREATE TABLE IF NOT EXISTS areas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id           UUID NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,        -- エリア名
  population_delta  FLOAT NOT NULL DEFAULT 0,  -- 人口増減率（%）
  transaction_count INT NOT NULL DEFAULT 0,    -- 取引件数
  avg_price_level   FLOAT NOT NULL DEFAULT 0,  -- 平均価格水準（万円/㎡）
  -- スコア（計算済みキャッシュ、上限100）
  score             FLOAT GENERATED ALWAYS AS (
    LEAST(
      transaction_count * 0.4 +
      population_delta  * 0.3 +
      avg_price_level   * 0.3,
      100.0
    )
  ) STORED,
  tier              TEXT GENERATED ALWAYS AS (
    CASE
      WHEN LEAST(transaction_count * 0.4 + population_delta * 0.3 + avg_price_level * 0.3, 100.0) >= 70 THEN 'A'
      WHEN LEAST(transaction_count * 0.4 + population_delta * 0.3 + avg_price_level * 0.3, 100.0) >= 40 THEN 'B'
      ELSE 'C'
    END
  ) STORED,
  -- GeoJSON ポリゴン（Leaflet 表示用）
  geojson           JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_areas_city_id ON areas(city_id);
CREATE INDEX IF NOT EXISTS idx_areas_tier    ON areas(tier);
CREATE INDEX IF NOT EXISTS idx_areas_score   ON areas(score DESC);

-- updated_at 自動更新
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_areas_updated_at
  BEFORE UPDATE ON areas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Row Level Security
-- ============================================

ALTER TABLE cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE areas  ENABLE ROW LEVEL SECURITY;

-- 認証済みユーザーは全都市・エリアを閲覧可能
CREATE POLICY "cities_read_authenticated"
  ON cities FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "areas_read_authenticated"
  ON areas FOR SELECT
  USING (auth.role() = 'authenticated');

-- ============================================
-- サンプルデータ
-- ============================================

INSERT INTO cities (name, name_en, center_lat, center_lng, zoom_level) VALUES
  ('鹿児島', 'kagoshima', 31.5966, 130.5571, 12),
  ('仙台',   'sendai',    38.2682, 140.8694, 12),
  ('愛知',   'aichi',     35.1802, 136.9066, 11),
  ('東海',   'tokai',     34.9756, 137.1446,  9)
ON CONFLICT DO NOTHING;

-- 鹿児島サンプルエリア
WITH city AS (SELECT id FROM cities WHERE name_en = 'kagoshima')
INSERT INTO areas (city_id, name, population_delta, transaction_count, avg_price_level, geojson)
SELECT
  city.id,
  area.name,
  area.pop,
  area.txn,
  area.price,
  NULL
FROM city, (VALUES
  ('鹿児島市 中央区',  3.2, 85,  45.0),
  ('鹿児島市 谷山',    1.1, 62,  32.0),
  ('鹿児島市 鴨池',   -0.5, 48,  38.5),
  ('鹿児島市 武岡',    0.8, 41,  29.0),
  ('鹿児島市 伊敷',   -1.2, 33,  25.5),
  ('鹿児島市 吉野',    2.1, 55,  35.0),
  ('鹿児島市 郡元',    0.3, 44,  31.0),
  ('鹿児島市 城西',   -0.8, 28,  27.5)
) AS area(name, pop, txn, price);

-- 仙台サンプルエリア
WITH city AS (SELECT id FROM cities WHERE name_en = 'sendai')
INSERT INTO areas (city_id, name, population_delta, transaction_count, avg_price_level, geojson)
SELECT
  city.id,
  area.name,
  area.pop,
  area.txn,
  area.price,
  NULL
FROM city, (VALUES
  ('仙台市 青葉区',    2.5, 92,  52.0),
  ('仙台市 宮城野区',  1.8, 78,  41.0),
  ('仙台市 若林区',    0.6, 61,  36.5),
  ('仙台市 太白区',    1.2, 67,  38.0),
  ('仙台市 泉区',      3.1, 88,  44.5),
  ('仙台市 長町',      2.8, 74,  46.0),
  ('仙台市 八木山',   -0.3, 39,  30.0),
  ('仙台市 多賀城',    0.9, 51,  33.5)
) AS area(name, pop, txn, price);

-- 愛知サンプルエリア
WITH city AS (SELECT id FROM cities WHERE name_en = 'aichi')
INSERT INTO areas (city_id, name, population_delta, transaction_count, avg_price_level, geojson)
SELECT
  city.id,
  area.name,
  area.pop,
  area.txn,
  area.price,
  NULL
FROM city, (VALUES
  ('名古屋市 中区',    1.9, 95,  68.0),
  ('名古屋市 千種区',  2.3, 82,  55.0),
  ('名古屋市 昭和区',  0.7, 71,  49.5),
  ('名古屋市 瑞穂区',  0.4, 58,  43.0),
  ('名古屋市 熱田区',  1.1, 64,  45.5),
  ('名古屋市 中川区',  0.2, 53,  37.0),
  ('豊田市 中心部',    1.6, 69,  42.0),
  ('豊橋市 中心部',    0.5, 47,  34.5),
  ('岡崎市 中心部',    1.3, 61,  39.0),
  ('一宮市 中心部',    0.8, 55,  36.0)
) AS area(name, pop, txn, price);

-- 東海サンプルエリア
WITH city AS (SELECT id FROM cities WHERE name_en = 'tokai')
INSERT INTO areas (city_id, name, population_delta, transaction_count, avg_price_level, geojson)
SELECT
  city.id,
  area.name,
  area.pop,
  area.txn,
  area.price,
  NULL
FROM city, (VALUES
  ('静岡市 葵区',      1.2, 74,  42.0),
  ('静岡市 駿河区',    0.8, 61,  38.5),
  ('浜松市 中区',      1.5, 82,  44.0),
  ('浜松市 東区',      0.6, 55,  33.0),
  ('岐阜市 中心部',    0.9, 68,  37.5),
  ('大垣市 中心部',    0.3, 44,  29.0),
  ('各務原市 中心部',  1.1, 51,  32.0),
  ('津市 中心部',      0.4, 49,  31.0),
  ('四日市市 中心部',  1.7, 77,  46.0),
  ('鈴鹿市 中心部',    0.7, 53,  34.5)
) AS area(name, pop, txn, price);

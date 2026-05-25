-- 東海エリア（静岡・岐阜・三重）追加マイグレーション
-- Run this in the Supabase SQL editor if the Tokai city is not yet in the database.

INSERT INTO cities (name, name_en, center_lat, center_lng, zoom_level)
SELECT '東海', 'tokai', 34.9756, 137.1446, 9
WHERE NOT EXISTS (SELECT 1 FROM cities WHERE name_en = 'tokai');

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
) AS area(name, pop, txn, price)
WHERE NOT EXISTS (SELECT 1 FROM areas WHERE city_id = city.id);

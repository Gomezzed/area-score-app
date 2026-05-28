-- 近畿エリア（大阪府・兵庫県）追加マイグレーション
-- Run this in the Supabase SQL editor if the Kinki city is not yet in the database.

INSERT INTO cities (name, name_en, center_lat, center_lng, zoom_level)
SELECT '近畿', 'kinki', 34.6937, 135.5022, 9
WHERE NOT EXISTS (SELECT 1 FROM cities WHERE name_en = 'kinki');

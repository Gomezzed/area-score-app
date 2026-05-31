-- 関東エリア（東京・神奈川・千葉・埼玉）追加マイグレーション
-- Run this in the Supabase SQL editor if the Kanto city is not yet in the database.

INSERT INTO cities (name, name_en, center_lat, center_lng, zoom_level)
SELECT '関東', 'kanto', 35.6894, 139.6917, 9
WHERE NOT EXISTS (SELECT 1 FROM cities WHERE name_en = 'kanto');

-- 北陸・甲信越エリア（新潟・富山・石川・福井・山梨・長野）追加マイグレーション
-- Run this in the Supabase SQL editor if the city is not yet in the database.

INSERT INTO cities (name, name_en, center_lat, center_lng, zoom_level)
SELECT '北陸・甲信越', 'koshinetsu_hokuriku', 36.9, 137.8, 7
WHERE NOT EXISTS (SELECT 1 FROM cities WHERE name_en = 'koshinetsu_hokuriku');

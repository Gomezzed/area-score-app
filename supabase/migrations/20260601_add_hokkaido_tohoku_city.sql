-- 北海道・東北エリア（北海道・青森・岩手・宮城・秋田・山形・福島）追加マイグレーション
-- Run this in the Supabase SQL editor if the city is not yet in the database.

INSERT INTO cities (name, name_en, center_lat, center_lng, zoom_level)
SELECT '北海道・東北', 'hokkaido_tohoku', 40.5, 141.0, 6
WHERE NOT EXISTS (SELECT 1 FROM cities WHERE name_en = 'hokkaido_tohoku');

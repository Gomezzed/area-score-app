-- 中国・四国エリア（鳥取・島根・岡山・広島・山口・徳島・香川・愛媛・高知）追加マイグレーション
-- Run this in the Supabase SQL editor if the city is not yet in the database.

INSERT INTO cities (name, name_en, center_lat, center_lng, zoom_level)
SELECT '中国・四国', 'chugoku_shikoku', 34.2, 133.5, 7
WHERE NOT EXISTS (SELECT 1 FROM cities WHERE name_en = 'chugoku_shikoku');

-- 九州・沖縄エリア（福岡・佐賀・長崎・熊本・大分・宮崎・沖縄）追加マイグレーション
-- 鹿児島県は別途 kagoshima タブで管理するため除外しています。
-- Run this in the Supabase SQL editor if the city is not yet in the database.

INSERT INTO cities (name, name_en, center_lat, center_lng, zoom_level)
SELECT '九州・沖縄', 'kyushu_okinawa', 32.8, 130.7, 7
WHERE NOT EXISTS (SELECT 1 FROM cities WHERE name_en = 'kyushu_okinawa');

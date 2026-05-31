-- 全エリア都市テーブル 一括シード
-- Idempotent: safe to re-run. Inserts any city row that does not yet exist.
-- Run this once in the Supabase SQL editor to populate all region tabs.

DO $$
DECLARE
  rows RECORD;
BEGIN
  FOR rows IN
    SELECT *
    FROM (VALUES
      ('仙台',         'sendai',              38.2682, 140.8694,  12),
      ('愛知',         'aichi',               35.1802, 136.9066,  11),
      ('鹿児島',       'kagoshima',           31.5966, 130.5571,  12),
      ('東海',         'tokai',               34.9756, 137.1446,   9),
      ('近畿',         'kinki',               34.8500, 135.6500,   8),
      ('関東',         'kanto',               35.6894, 139.6917,   9),
      ('北海道・東北', 'hokkaido_tohoku',     40.5000, 141.0000,   6),
      ('北陸・甲信越', 'koshinetsu_hokuriku', 36.9000, 137.8000,   7),
      ('中国・四国',   'chugoku_shikoku',     34.2000, 133.5000,   7),
      ('九州・沖縄',   'kyushu_okinawa',      32.8000, 130.7000,   7)
    ) AS t(name, name_en, center_lat, center_lng, zoom_level)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM cities WHERE name_en = rows.name_en) THEN
      INSERT INTO cities (name, name_en, center_lat, center_lng, zoom_level)
      VALUES (rows.name, rows.name_en, rows.center_lat, rows.center_lng, rows.zoom_level);
    ELSE
      UPDATE cities
      SET name = rows.name, center_lat = rows.center_lat,
          center_lng = rows.center_lng, zoom_level = rows.zoom_level
      WHERE name_en = rows.name_en;
    END IF;
  END LOOP;
END $$;

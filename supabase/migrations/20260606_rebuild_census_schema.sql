-- ============================================================
-- REBUILD: 国勢調査ベースの新データスキーマ
--   prefectures / municipalities / population_stats
--   2015年・2020年 国勢調査（総務省統計局 e-Stat）
-- ============================================================

-- ── Table 1: prefectures（都道府県マスタ）──────────────────
CREATE TABLE IF NOT EXISTS prefectures (
  code        TEXT PRIMARY KEY,           -- '01', '02' ... '47'
  name        TEXT NOT NULL,              -- '北海道', '青森県'
  name_en     TEXT NOT NULL,              -- 'hokkaido', 'aomori'
  region      TEXT NOT NULL,              -- 'hokkaido_tohoku', 'kanto', ...
  center_lat  DOUBLE PRECISION,
  center_lng  DOUBLE PRECISION,
  zoom_level  INTEGER DEFAULT 9
);

-- ── Table 2: municipalities（市区町村マスタ）────────────────
CREATE TABLE IF NOT EXISTS municipalities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prefecture_code TEXT REFERENCES prefectures(code),
  city_code       TEXT,                   -- e-Stat city code（自然キー）
  name            TEXT NOT NULL,          -- '札幌市', '函館市'
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION
);

-- city_code を一意にして upsert 可能にする
CREATE UNIQUE INDEX IF NOT EXISTS idx_municipalities_city_code
  ON municipalities(city_code);
CREATE INDEX IF NOT EXISTS idx_municipalities_pref
  ON municipalities(prefecture_code);

-- ── Table 3: population_stats（人口統計：年次）──────────────
CREATE TABLE IF NOT EXISTS population_stats (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id       UUID REFERENCES municipalities(id) ON DELETE CASCADE,
  year                  INTEGER,          -- 2015 or 2020
  population            BIGINT,           -- 実数 e.g. 1975000
  households            BIGINT,
  population_delta      BIGINT,           -- 前回国勢調査からの増減数
  population_delta_rate DOUBLE PRECISION  -- 増減率（%）e.g. -1.23
);

-- (municipality_id, year) を一意にして upsert 可能にする
CREATE UNIQUE INDEX IF NOT EXISTS idx_population_stats_muni_year
  ON population_stats(municipality_id, year);

-- ── 47都道府県シード ───────────────────────────────────────
INSERT INTO prefectures (code, name, name_en, region, center_lat, center_lng, zoom_level) VALUES
  ('01', '北海道',   'hokkaido',  'hokkaido_tohoku', 43.0642, 141.3469, 7),
  ('02', '青森県',   'aomori',    'hokkaido_tohoku', 40.8244, 140.7400, 8),
  ('03', '岩手県',   'iwate',     'hokkaido_tohoku', 39.7036, 141.1527, 8),
  ('04', '宮城県',   'miyagi',    'hokkaido_tohoku', 38.2688, 140.8721, 9),
  ('05', '秋田県',   'akita',     'hokkaido_tohoku', 39.7186, 140.1024, 8),
  ('06', '山形県',   'yamagata',  'hokkaido_tohoku', 38.2404, 140.3633, 9),
  ('07', '福島県',   'fukushima', 'hokkaido_tohoku', 37.7503, 140.4676, 8),
  ('08', '茨城県',   'ibaraki',   'kanto',           36.3418, 140.4468, 9),
  ('09', '栃木県',   'tochigi',   'kanto',           36.5657, 139.8836, 9),
  ('10', '群馬県',   'gunma',     'kanto',           36.3907, 139.0604, 9),
  ('11', '埼玉県',   'saitama',   'kanto',           35.8570, 139.6489, 10),
  ('12', '千葉県',   'chiba',     'kanto',           35.6051, 140.1233, 9),
  ('13', '東京都',   'tokyo',     'kanto',           35.6895, 139.6917, 10),
  ('14', '神奈川県', 'kanagawa',  'kanto',           35.4478, 139.6425, 10),
  ('15', '新潟県',   'niigata',   'chubu',           37.9026, 139.0234, 8),
  ('16', '富山県',   'toyama',    'chubu',           36.6953, 137.2113, 9),
  ('17', '石川県',   'ishikawa',  'chubu',           36.5947, 136.6256, 9),
  ('18', '福井県',   'fukui',     'chubu',           36.0652, 136.2216, 9),
  ('19', '山梨県',   'yamanashi', 'chubu',           35.6642, 138.5684, 9),
  ('20', '長野県',   'nagano',    'chubu',           36.6513, 138.1810, 8),
  ('21', '岐阜県',   'gifu',      'chubu',           35.3912, 136.7223, 9),
  ('22', '静岡県',   'shizuoka',  'chubu',           34.9769, 138.3831, 9),
  ('23', '愛知県',   'aichi',     'chubu',           35.1802, 136.9066, 9),
  ('24', '三重県',   'mie',       'chubu',           34.7303, 136.5086, 9),
  ('25', '滋賀県',   'shiga',     'kinki',           35.0045, 135.8686, 9),
  ('26', '京都府',   'kyoto',     'kinki',           35.0211, 135.7556, 9),
  ('27', '大阪府',   'osaka',     'kinki',           34.6863, 135.5200, 10),
  ('28', '兵庫県',   'hyogo',     'kinki',           34.6913, 135.1830, 9),
  ('29', '奈良県',   'nara',      'kinki',           34.6851, 135.8328, 9),
  ('30', '和歌山県', 'wakayama',  'kinki',           34.2261, 135.1675, 9),
  ('31', '鳥取県',   'tottori',   'chugoku_shikoku', 35.5036, 134.2383, 9),
  ('32', '島根県',   'shimane',   'chugoku_shikoku', 35.4723, 133.0505, 8),
  ('33', '岡山県',   'okayama',   'chugoku_shikoku', 34.6618, 133.9344, 9),
  ('34', '広島県',   'hiroshima', 'chugoku_shikoku', 34.3966, 132.4596, 9),
  ('35', '山口県',   'yamaguchi', 'chugoku_shikoku', 34.1859, 131.4714, 9),
  ('36', '徳島県',   'tokushima', 'chugoku_shikoku', 34.0658, 134.5593, 9),
  ('37', '香川県',   'kagawa',    'chugoku_shikoku', 34.3401, 134.0434, 10),
  ('38', '愛媛県',   'ehime',     'chugoku_shikoku', 33.8416, 132.7657, 9),
  ('39', '高知県',   'kochi',     'chugoku_shikoku', 33.5597, 133.5311, 9),
  ('40', '福岡県',   'fukuoka',   'kyushu_okinawa',  33.6064, 130.4181, 9),
  ('41', '佐賀県',   'saga',      'kyushu_okinawa',  33.2494, 130.2988, 9),
  ('42', '長崎県',   'nagasaki',  'kyushu_okinawa',  32.7448, 129.8737, 9),
  ('43', '熊本県',   'kumamoto',  'kyushu_okinawa',  32.7898, 130.7417, 9),
  ('44', '大分県',   'oita',      'kyushu_okinawa',  33.2382, 131.6126, 9),
  ('45', '宮崎県',   'miyazaki',  'kyushu_okinawa',  31.9111, 131.4239, 9),
  ('46', '鹿児島県', 'kagoshima', 'kyushu_okinawa',  31.5602, 130.5581, 8),
  ('47', '沖縄県',   'okinawa',   'kyushu_okinawa',  26.2124, 127.6809, 9)
ON CONFLICT (code) DO UPDATE SET
  name       = EXCLUDED.name,
  name_en    = EXCLUDED.name_en,
  region     = EXCLUDED.region,
  center_lat = EXCLUDED.center_lat,
  center_lng = EXCLUDED.center_lng,
  zoom_level = EXCLUDED.zoom_level;

-- =====================================================================
--  全国マンションデータベース  schema  (PostgreSQL 15+ / PostGIS 3.x)
-- ---------------------------------------------------------------------
--  設計方針（確定事項）:
--   1. 取引(transactions)は物件(properties)に強制FKしない。
--      不動産情報ライブラリ(取引価格)は匿名化され町丁目単位のため、
--      突合できた時のみ property_id を張り、確信度を match_confidence に記録。
--   2. エリアスコアの核は「町丁目(area_stats) × 取引町丁目集計 × 立地属性」。
--   3. 出典は source_log にバッチ(run×table×source×pref)単位で記録し、
--      各表の source 列で補完する。
--   4. OSM(ODbL継承)由来データは osm_buildings に分離して管理する。
--  共通ルール: SRID=4326(WGS84) 統一 / GIST空間index / コードはゼロ埋め保持(TEXT)
--              / 日付はDATE / 欠損はNULL(ダミー禁止) / 1カラム1値(複数値はJSONB)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- 住所・名称のあいまい名寄せ
CREATE EXTENSION IF NOT EXISTS unaccent;   -- 表記ゆれ吸収(任意)

-- ---------------------------------------------------------------------
-- 参照マスタ: 全国地方公共団体コード(ゼロ埋め保持の基準点)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS municipalities (
  city_code   TEXT PRIMARY KEY CHECK (city_code ~ '^[0-9]{5}$'),  -- JIS 5桁
  pref_code   TEXT NOT NULL    CHECK (pref_code ~ '^[0-9]{2}$'),
  pref_name   TEXT NOT NULL,
  city_name   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_muni_pref ON municipalities (pref_code);

-- ---------------------------------------------------------------------
-- 相場・公示価格・路線価・金利・家賃の統合メトリクス
-- confirmed(公表事実) と reference(参考・当社集計) を value_type で分離する。
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_metrics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  muni_code     TEXT NOT NULL REFERENCES municipalities(city_code)
                CHECK (muni_code ~ '^[0-9]{5}$'),
  metric_type   TEXT NOT NULL CHECK (metric_type IN
                  ('trade_price','official_land_price','rosenka','interest_rate','rent')),
  value_type    TEXT NOT NULL CHECK (value_type IN ('confirmed','reference')),
  property_type TEXT NOT NULL DEFAULT '',
  year          INTEGER NOT NULL,
  quarter       INTEGER CHECK (quarter BETWEEN 1 AND 4),
  value         NUMERIC NOT NULL,
  unit          TEXT NOT NULL,
  sample_count  INTEGER CHECK (sample_count IS NULL OR sample_count >= 0),
  source        TEXT NOT NULL,
  source_detail JSONB,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_market_metrics_period UNIQUE NULLS NOT DISTINCT
    (muni_code, metric_type, value_type, property_type, year, quarter)
);
CREATE INDEX IF NOT EXISTS idx_mm_muni_year ON market_metrics (muni_code, year);
CREATE INDEX IF NOT EXISTS idx_mm_type      ON market_metrics (metric_type, value_type);

ALTER TABLE market_metrics ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF to_regprocedure('auth.role()') IS NOT NULL
     AND to_regprocedure('auth.jwt()') IS NOT NULL THEN
    DROP POLICY IF EXISTS "mm_read_authenticated" ON market_metrics;
    EXECUTE 'CREATE POLICY "mm_read_authenticated"
      ON market_metrics FOR SELECT
      USING (auth.role() = ''authenticated'')';

    DROP POLICY IF EXISTS "mm_service_role_all" ON market_metrics;
    EXECUTE 'CREATE POLICY "mm_service_role_all"
      ON market_metrics FOR ALL
      USING (auth.jwt() ->> ''role'' = ''service_role'')
      WITH CHECK (auth.jwt() ->> ''role'' = ''service_role'')';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 物件マスタ (建物実体を持てる範囲で。主に OSM + ジオコーディング由来)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS properties (
  property_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name               TEXT,
  address_raw        TEXT,
  address_normalized TEXT,
  normalized_key     TEXT NOT NULL,                 -- 名寄せ / 冪等UPSERT衝突キー
  pref_code          TEXT CHECK (pref_code ~ '^[0-9]{2}$'),
  city_code          TEXT REFERENCES municipalities(city_code),
  geom               geometry(Point, 4326),
  built_ym           DATE,                           -- 月精度(日は01固定)
  built_precision    TEXT CHECK (built_precision IN ('year','month','day')),
  structure          TEXT,
  total_units        INTEGER  CHECK (total_units > 0),
  floors             SMALLINT CHECK (floors > 0),
  source             TEXT NOT NULL,
  source_id          TEXT,                           -- 出所側の識別子(OSM id等)
  fetched_at         TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_properties_norm UNIQUE (normalized_key)
);
CREATE INDEX IF NOT EXISTS idx_prop_geom      ON properties USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_prop_city      ON properties (city_code);
CREATE INDEX IF NOT EXISTS idx_prop_pref      ON properties (pref_code);
CREATE INDEX IF NOT EXISTS idx_prop_addr_trgm ON properties USING GIN (address_normalized gin_trgm_ops);

-- ---------------------------------------------------------------------
-- 取引履歴 (不動産情報ライブラリ XIT001。匿名・町丁目単位。建物FKは任意)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  transaction_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  property_id      BIGINT REFERENCES properties(property_id),  -- NULL許容(突合時のみ)
  match_confidence NUMERIC CHECK (match_confidence BETWEEN 0 AND 1),
  -- 非正規化した立地(XIT001は町丁目までしか持たないため)
  pref_code        TEXT CHECK (pref_code ~ '^[0-9]{2}$'),
  city_code        TEXT REFERENCES municipalities(city_code),
  district_code    TEXT,                       -- XIT001 DistrictCode (9桁: 市区町村5+町丁目4)
  district_name    TEXT,                       -- 地区名
  geom             geometry(Point, 4326),      -- 町丁目セントロイド(付与できた場合)
  -- 取引内容
  property_type    TEXT,                       -- Type 例: 中古マンション等
  traded_year      SMALLINT,
  traded_quarter   SMALLINT CHECK (traded_quarter BETWEEN 1 AND 4),
  traded_period    DATE,                       -- 四半期初日(精度は四半期)
  price            BIGINT  CHECK (price >= 0), -- 円
  area             NUMERIC CHECK (area > 0),   -- m^2
  unit_price       NUMERIC,                    -- 円/m^2 (取得 or 導出)
  layout           TEXT,                       -- 間取り (FloorPlan)
  building_year    SMALLINT,                   -- 築年(西暦)
  structure        TEXT,
  use_type         TEXT,                       -- Use 用途
  city_planning    TEXT,                       -- CityPlanning 用途地域
  nearest_station  TEXT,
  station_minutes  SMALLINT,                   -- 駅徒歩分
  renovation       TEXT,
  source           TEXT NOT NULL,
  fetched_at       TIMESTAMPTZ NOT NULL,
  row_hash         TEXT NOT NULL,              -- 全フィールドハッシュ = 冪等UPSERT衝突キー
  CONSTRAINT uq_txn_hash UNIQUE (row_hash)
);
CREATE INDEX IF NOT EXISTS idx_txn_geom     ON transactions USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_txn_city     ON transactions (city_code);
CREATE INDEX IF NOT EXISTS idx_txn_district ON transactions (city_code, district_code);
CREATE INDEX IF NOT EXISTS idx_txn_period   ON transactions (traded_year, traded_quarter);
CREATE INDEX IF NOT EXISTS idx_txn_prop     ON transactions (property_id);

-- ---------------------------------------------------------------------
-- 立地属性 (物件に1:1。用途地域/駅/地価を空間結合で付与)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS location_attributes (
  property_id        BIGINT PRIMARY KEY REFERENCES properties(property_id) ON DELETE CASCADE,
  zoning             TEXT,        -- 用途地域(国土数値情報 空間結合)
  nearest_station    TEXT,
  station_distance_m INTEGER CHECK (station_distance_m >= 0),
  land_price         BIGINT,      -- 最寄地価公示点 円/m^2
  land_price_year    SMALLINT,
  source             TEXT,
  fetched_at         TIMESTAMPTZ NOT NULL
);

-- ---------------------------------------------------------------------
-- エリア統計 (e-Stat由来 / Webアプリのスコア核 / 町丁目単位)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS area_stats (
  area_stats_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pref_code       TEXT CHECK (pref_code ~ '^[0-9]{2}$'),
  city_code       TEXT REFERENCES municipalities(city_code),
  town_code       TEXT NOT NULL DEFAULT '',     -- 小地域(町丁目)コード ('' = 市区町村全体)
  stat_year       SMALLINT NOT NULL,
  population      INTEGER,
  pop_change_rate NUMERIC,
  households      INTEGER,
  age_structure   JSONB,                        -- 年齢構成(複数値はJSONBで)
  geom            geometry(MultiPolygon, 4326),
  source          TEXT NOT NULL,
  fetched_at      TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_area UNIQUE (city_code, town_code, stat_year)
);
CREATE INDEX IF NOT EXISTS idx_area_geom ON area_stats USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_area_city ON area_stats (city_code);
CREATE INDEX IF NOT EXISTS idx_area_pref ON area_stats (pref_code);
CREATE INDEX IF NOT EXISTS idx_area_town ON area_stats (city_code, town_code);

-- ---------------------------------------------------------------------
-- OSM建物 (ODbL継承を分離するための専用テーブル)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS osm_buildings (
  osm_id      BIGINT PRIMARY KEY,             -- OSM way/relation id
  name        TEXT,
  building    TEXT,                           -- building=* tag
  levels      SMALLINT,                       -- building:levels
  geom        geometry(MultiPolygon, 4326),
  tags        JSONB,
  source      TEXT NOT NULL DEFAULT 'openstreetmap',
  license     TEXT NOT NULL DEFAULT 'ODbL-1.0',
  fetched_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_osm_geom ON osm_buildings USING GIST (geom);

-- ---------------------------------------------------------------------
-- 出典・ライセンス (バッチ粒度。各表 source 列で補完)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_log (
  record_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id        TEXT NOT NULL,
  table_name    TEXT NOT NULL,
  source_name   TEXT NOT NULL,
  source_url    TEXT,
  license       TEXT NOT NULL,
  pref_code     TEXT,
  record_count  INTEGER,
  fetched_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_srclog_run ON source_log (run_id);

-- ---------------------------------------------------------------------
-- パイプライン・チェックポイント (47都道府県の再開可能性)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pipeline_checkpoint (
  run_id       TEXT NOT NULL,
  stage        TEXT NOT NULL CHECK (stage IN ('collect','transform','load')),
  source       TEXT NOT NULL,
  pref_code    TEXT NOT NULL CHECK (pref_code ~ '^[0-9]{2}$'),
  status       TEXT NOT NULL CHECK (status IN ('pending','running','done','error')),
  record_count INTEGER,
  error        TEXT,
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  PRIMARY KEY (run_id, stage, source, pref_code)
);

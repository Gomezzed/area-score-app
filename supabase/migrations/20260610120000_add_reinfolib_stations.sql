-- ============================================================================
--  20260610120000_add_reinfolib_stations.sql
--
--  国土交通省「不動産情報ライブラリ」(REINFOLIB) 連携:
--    (B) 駅別乗降客数 XKT015 の駅明細を保持する stations テーブルを新設し、
--        市区町村単位の集約値 municipalities.station_passengers_total を追加する。
--    (A) マンション取引履歴 XIT001 は既存 real_estate_transactions を再利用する
--        ため、本マイグレーションではテーブルを追加しない（下部 NOTE 参照）。
--
--  ─ 設計メモ（重要・要件定義との差分）──────────────────────────────────────
--   要件定義では駅を cities(id) に紐付け、集約値を areas に持たせる想定だった。
--   しかし本リポジトリの現行データ層は cities/areas（4都市のサンプル）ではなく
--   prefectures → municipalities（全国 約1,700 市区町村）→ population_stats /
--   real_estate_transactions である（UI・型・既存スクリプトすべて municipalities
--   を参照）。要件定義の「所属 city_id（その市区町村）」は意味的に
--   municipalities.id に対応するため、stations.municipality_id として実装する。
--   集約カラムも UI が参照する municipalities 側に追加する。
--   legacy な cities/areas（および areas の GENERATED 列 score/tier）には一切
--   手を加えない（既存機能を壊さないため）。
--  ────────────────────────────────────────────────────────────────────────
-- ============================================================================

BEGIN;

-- ── Table: stations（駅明細：XKT015）─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 所属市区町村。駅座標から最近傍 municipality 重心で解決（近似。NULL 許容）。
  municipality_id    UUID REFERENCES municipalities(id) ON DELETE CASCADE,
  prefecture_code    TEXT,                 -- 走査時の都道府県コード（'46' 等）
  station_code       TEXT,                 -- S12_001c（駅コード6桁）
  group_code         TEXT NOT NULL,        -- S12_001g（グループコード6桁・重複排除キー）
  name               TEXT NOT NULL,        -- S12_001_ja（駅名）
  operator           TEXT,                 -- S12_002_ja（運営会社）
  line_name          TEXT,                 -- S12_003_ja（路線名）
  passengers_latest  INTEGER,              -- 最新乗降客数（S12_057=2023 を優先）
  passengers_year    INTEGER,              -- 上記がどの年か（例 2023）
  lat                DOUBLE PRECISION,     -- 緯度（GeoJSON Point の [1]）
  lng                DOUBLE PRECISION,     -- 経度（GeoJSON Point の [0]）
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- group_code（S12_001g）を一意にして重複排除＆ upsert を可能にする
CREATE UNIQUE INDEX IF NOT EXISTS idx_stations_group_code ON stations(group_code);
CREATE INDEX IF NOT EXISTS idx_stations_municipality ON stations(municipality_id);
CREATE INDEX IF NOT EXISTS idx_stations_prefecture   ON stations(prefecture_code);

-- updated_at 自動更新（既存トリガ関数 update_updated_at を流用）
DROP TRIGGER IF EXISTS trg_stations_updated_at ON stations;
CREATE TRIGGER trg_stations_updated_at
  BEFORE UPDATE ON stations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 集約カラム: municipalities.station_passengers_total ──────────────────────
--   その市区町村に属する駅の「最新乗降客数」合計。既存 UI / CSV が参照する。
--   TODO(score): 将来エリアスコアに組み込む場合は、人口規模等で正規化した値を
--   ここから加算する余地がある（現状スコア式は未変更。legacy areas.score とは別系統）。
ALTER TABLE municipalities
  ADD COLUMN IF NOT EXISTS station_passengers_total BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN municipalities.station_passengers_total IS
  'その市区町村に属する駅の最新乗降客数の合計（出典: 国交省 XKT015 / 駅別乗降客数）。';

-- ── RLS: stations も既存テーブルと同様 authenticated に SELECT を許可 ─────────
ALTER TABLE public.stations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read stations" ON public.stations;
CREATE POLICY "authenticated read stations"
  ON public.stations FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON POLICY "authenticated read stations" ON public.stations IS
  '認証済ユーザーのみ SELECT 可。書き込みは service_role キー限定。';

COMMIT;

-- ============================================================================
-- NOTE: マンション取引履歴（XIT001）について
--   明細テーブル（mansion_transactions）は「作らない」を選択した。
--   理由: 既存 real_estate_transactions（city_code × year × quarter で集約、
--   UNIQUE(city_code, year, quarter)）と TransactionSection / useTransactions が
--   既に稼働しており、XIT001 の取得結果は同テーブルへ upsert すれば既存 UI に
--   そのまま反映される。明細を別途保持する要件は現時点で無く、二重管理を避ける。
--   （将来、間取り・地区名など物件単位の明細が必要になった時点で別マイグレで追加）
-- ============================================================================

-- ============================================================================
-- 検証クエリ（適用後に手動実行）
-- ============================================================================
-- 1. テーブル/カラム作成確認:
--    SELECT column_name FROM information_schema.columns
--      WHERE table_name='stations' ORDER BY ordinal_position;
--    SELECT column_name FROM information_schema.columns
--      WHERE table_name='municipalities' AND column_name='station_passengers_total';
-- 2. RLS 確認:
--    SELECT tablename, rowsecurity FROM pg_tables
--      WHERE schemaname='public' AND tablename='stations';
-- 3. 投入後の件数/集約確認（鹿児島）:
--    SELECT COUNT(*) FROM stations WHERE prefecture_code='46';
--    SELECT name, station_passengers_total FROM municipalities
--      WHERE prefecture_code='46' AND station_passengers_total > 0
--      ORDER BY station_passengers_total DESC LIMIT 10;
-- ============================================================================

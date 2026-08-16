-- =====================================================================
-- 20260816000000_step3_create_geo_reference_points.sql
-- M2-5a / SD-31・SD-32: 国土交通省「位置参照情報」(街区レベル / 大字・町丁目レベル)の
--   代表点を格納する点データテーブル。住所→座標のジオコーディング元。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う(R7・D57)。
--   ※ supabase db push は恒久禁止。
--
-- 前提:
--   - PostGIS は既に有効化済み(extensions スキーマ配置・実測 v3.3.7)。本 migration では
--     有効化しない(CREATE EXTENSION postgis は書かない)。
--   - DB の search_path に extensions が含まれる。よって geometry 型および
--     ST_SetSRID / ST_MakePoint は、適用実績のある 20260814110100(school_districts)と
--     同じ流儀で「非修飾」で参照する(スキーマ修飾しない)。
--   - 位置参照情報は世界測地系の十進経緯度(JGD2011 相当)。そのまま SRID 4326 として格納する
--     (school_districts と同一。ST_Contains の前提)。
--
-- 方針(SD-32=案A):
--   - 点データを「忠実に」保存する。ISJ の生フィールド(大字丁目名/小字通称名/街区符号)を
--     そのまま格納し、住所正規化・キー分割は行わない(正規化器の一般化は M2-5b の管轄)。
--   - 対象は公開8市のみ・街区は代表フラグ=1 の点のみ(絞り込みはローダーが行う)。
--   - アクセス権は deny-by-default: RLS 有効・anon/authenticated へのポリシーは作らない。
--     service_role の書込みポリシーのみ(stations の "service_role writes" と同型)。
--     クライアントがこのテーブルを直読みする設計にはしない。
--   - プロベナンス列に商用可・出典義務の根拠(利用約款URL・出典表記)を保持する
--     (位置参照情報は利用約款で利用目的を制限せず商用可・出典表示義務。スパイクで実確認済み)。
--   - DDL のみ。データ INSERT は含めない(投入はローダー経由・service_role)。
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.geo_reference_points (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- レベル: 街区(block) / 大字・町丁目(town)。
  level             TEXT NOT NULL
                      CHECK (level IN ('block', 'town')),

  -- 自治体コード。muni_code_5 = 5桁(municipalities.city_code と整合)。
  -- 街区CSVには市区町村コード列が無いため、ローダーが (都道府県名,市区町村名) の
  -- 複合キー固定辞書(対象8市のみ)から解決して埋める(都道府県違いの同名市を拾わない・原則2)。
  muni_code_5       TEXT NOT NULL,
  pref_code         TEXT,
  muni_name         TEXT,

  -- ISJ 生フィールド(正規化しない)。NULL は UNIQUE(NULLs distinct)で冪等UPSERTを壊すため、
  -- 欠落は空文字 '' に統一する(block_raw / subarea_raw)。
  town_raw          TEXT NOT NULL,               -- 街区: 大字・丁目名 / 町丁目: 大字町丁目名
  subarea_raw       TEXT NOT NULL DEFAULT '',    -- 街区: 小字・通称名(無ければ '') / 町丁目: ''
  block_raw         TEXT NOT NULL DEFAULT '',    -- 街区: 街区符号・地番 / 町丁目: ''

  -- 座標。ISJ の十進経緯度をそのまま格納。geom は lon/lat から生成(SRID 4326)。
  lat               DOUBLE PRECISION NOT NULL,
  lon               DOUBLE PRECISION NOT NULL,
  -- GENERATED STORED。PostGIS 関数は非修飾(20260814110100 と同じ search_path 依存の流儀)。
  -- ローダーの UPSERT payload に geom を含めてはならない(GENERATED 列に明示値はエラー)。
  geom              geometry(Point, 4326) NOT NULL
                      GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat), 4326)) STORED,

  -- プロベナンス(出所・ライセンス)。
  source_type       TEXT NOT NULL,               -- データセット種別: MLIT_ISJ_BLOCK / MLIT_ISJ_TOWN
  source_version    TEXT NOT NULL,               -- ISJ ファイル版: 例 '24.0a'(街区) / '19.0b'(町丁目)
  source_date       DATE,                        -- 整備年度相当(判れば)
  source_url        TEXT NOT NULL,               -- 取得元(公式配布ZIPのURL)
  license_url       TEXT NOT NULL,               -- 利用約款URL(商用可・出典義務の根拠)
  attribution_text  TEXT NOT NULL,               -- 出典表記(例: 街区レベル位置参照情報 国土交通省 …)
  fetched_at        TIMESTAMPTZ NOT NULL,        -- 手動DL日時(ネットワーク取得の記録)

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 冪等 UPSERT の一意キー(版 × レベル × 自治体 × 生フィールド)。
  -- 空文字統一により NULLs distinct 問題を回避(subarea_raw / block_raw)。
  UNIQUE (source_version, level, muni_code_5, town_raw, subarea_raw, block_raw)
);

COMMENT ON TABLE public.geo_reference_points IS
  'M2-5a/SD-31・SD-32: 位置参照情報(街区/大字町丁目レベル代表点)。住所→座標のジオコーディング元。ISJ生フィールドを忠実格納し正規化はしない(正規化は M2-5b)。deny-by-default(anon/authenticated 直読み不可・service_role のみ書込み)。';
COMMENT ON COLUMN public.geo_reference_points.level IS
  'block(街区レベル・代表フラグ=1のみ) / town(大字・町丁目レベル)。';
COMMENT ON COLUMN public.geo_reference_points.muni_code_5 IS
  '5桁の全国地方公共団体コード相当(municipalities.city_code と整合)。街区CSVは名称のみのため (都道府県名,市区町村名) 複合キー辞書で解決する。桁合わせでの muni_code_6 との直接比較はしない。';
COMMENT ON COLUMN public.geo_reference_points.town_raw IS
  'ISJの大字丁目名(街区)/大字町丁目名(町丁目)の生値。正規化・分割はしない(M2-5b が突合キーを所有)。';
COMMENT ON COLUMN public.geo_reference_points.subarea_raw IS
  'ISJの小字・通称名の生値(街区のみ)。無ければ空文字。NULLは冪等UPSERTを壊すため使わない。';
COMMENT ON COLUMN public.geo_reference_points.block_raw IS
  'ISJの街区符号・地番の生値(街区のみ)。町丁目レベルは空文字。NULLは使わない。';
COMMENT ON COLUMN public.geo_reference_points.geom IS
  'GENERATED STORED: ST_SetSRID(ST_MakePoint(lon,lat),4326)。SRID 4326(school_districts と同一)。ローダーは geom を送らない(GENERATED)。';
COMMENT ON COLUMN public.geo_reference_points.source_version IS
  'ISJ ファイル版(例 24.0a=街区/19.0b=町丁目)。再取得で版が変わったら同一自然キーで UPSERT 上書きせず、版込みキーで別行として共存できる。';
COMMENT ON COLUMN public.geo_reference_points.license_url IS
  '利用約款URL(https://nlftp.mlit.go.jp/isj/agreement.html)。位置参照情報は利用目的を制限せず商用可・出典表示義務。';

-- ── インデックス ─────────────────────────────────────────────────────
-- 空間クエリ(下流の ST_Contains 等)用。
CREATE INDEX IF NOT EXISTS geo_reference_points_geom_gist
  ON public.geo_reference_points USING gist (geom);
-- M2-5b の突合(レベル×自治体×生フィールド)の高速化。
CREATE INDEX IF NOT EXISTS geo_reference_points_lookup_idx
  ON public.geo_reference_points (level, muni_code_5, town_raw, block_raw);

-- ── RLS: deny-by-default(service_role のみ書込み・クライアント直読みなし)──────────
ALTER TABLE public.geo_reference_points ENABLE ROW LEVEL SECURITY;

-- Supabase 既定の全権限グラントを剥奪。anon/authenticated には一切 GRANT しない
-- (このテーブルはクライアントが直読みしない。サーバー/ETL が service_role で扱う)。
REVOKE ALL ON public.geo_reference_points FROM anon, authenticated;

-- 書き込みは service_role のみ(ETL/データ投入)。service_role は RLS をバイパスするため
-- 実質ノーオペだが、意図を明示する(stations の "service_role writes" と同型)。
DROP POLICY IF EXISTS "geo_reference_points service_role writes" ON public.geo_reference_points;
CREATE POLICY "geo_reference_points service_role writes"
  ON public.geo_reference_points
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- SELECT/INSERT/UPDATE/DELETE の anon/authenticated ポリシーは作らない = deny-by-default。

COMMIT;

-- =====================================================================
-- ロールバック SQL(適用を取り消す場合・PM が手動実行):
--   BEGIN;
--   DROP POLICY IF EXISTS "geo_reference_points service_role writes" ON public.geo_reference_points;
--   DROP INDEX IF EXISTS public.geo_reference_points_lookup_idx;
--   DROP INDEX IF EXISTS public.geo_reference_points_geom_gist;
--   DROP TABLE IF EXISTS public.geo_reference_points;   -- ⚠ 投入済みデータも消える
--   COMMIT;
-- =====================================================================

-- =====================================================================
-- 検証クエリ(適用後に手動実行):
--   -- SRID/型:
--   SELECT DISTINCT ST_SRID(geom), GeometryType(geom) FROM public.geo_reference_points;
--   -- RLS 有効:
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.geo_reference_points'::regclass;
--   -- ポリシーが service_role の1件のみ:
--   SELECT policyname, roles, cmd FROM pg_policies
--   WHERE schemaname='public' AND tablename='geo_reference_points';
--   -- 自治体×レベル別の行数(ロード後):
--   SELECT muni_code_5, muni_name, level, count(*)
--   FROM public.geo_reference_points GROUP BY 1,2,3 ORDER BY 1,3;
-- =====================================================================

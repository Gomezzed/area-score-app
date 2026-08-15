-- =====================================================================
-- 20260814110100_step2_create_school_districts.sql
-- STEP2 / SD-20・SD-22: 学校区ポリゴン本体。
--   - ライセンス列は台帳(school_district_licenses)から非正規化して写す。
--   - is_public は生成列（GENERATED STORED）＝最大の安全装置。式を変えない。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う。
--   ※ 20260814110000_step2_create_school_district_licenses.sql を先に適用すること
--     （本ファイルの同期トリガーが台帳を参照するため）。
--
-- 前提:
--   - PostGIS は既に有効化済み（本 STEP2 では有効化しない。CREATE EXTENSION postgis は書かない）。
--   - 測地系 JGD2011(EPSG:6668) → ETL 側で SRID 4326 に変換して投入する。
--
-- 方針:
--   - is_public = 生成列。commercial_use=true かつ license_status='CLEARED' かつ
--     （attribution_required=false または attribution_text IS NOT NULL）。
--     入力 3 列を NOT NULL にしてあるので NULL 伝播は起きない。
--   - 判定単位は muni_code_5 × school_type。deny-by-default。
--   - プラン制限（Platinum）は本 migration では入れない。API 層 guardFeature と
--     STEP4 で追加する（下記コメント参照）。
-- =====================================================================

BEGIN;

-- ── ポリゴン本体 ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.school_districts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- コード（桁は台帳と同一。muni_code_6 は台帳から join して埋める。自前計算しない）。
  muni_code_5          TEXT NOT NULL,
  muni_code_6          TEXT,
  pref_code            TEXT,
  muni_name            TEXT,

  -- 学校種。compulsory は義務教育学校用の器のみ（STEP2 では判定ロジックを作らない）。
  school_type          TEXT NOT NULL
                         CHECK (school_type IN ('elementary', 'junior_high', 'compulsory')),

  -- 学校の識別子。SD-22: 1学校1行に統合する（ETL 側で school_key で dissolve）。
  school_code          TEXT,
  school_name          TEXT NOT NULL,
  school_address       TEXT,
  establisher_code     TEXT,
  -- 一意キー用の合成列: 学校コードがあればそれ、無ければ名称。
  school_key           TEXT GENERATED ALWAYS AS
                         (coalesce(nullif(school_code, ''), school_name)) STORED,

  -- ジオメトリ（SRID 4326 / MultiPolygon）。ETL 側で ST_Multi / ST_MakeValid 済みで投入。
  geom                 geometry(MultiPolygon, 4326) NOT NULL,

  -- 出所。source_type=データセット種別 / source_version=利用条件表の版（別概念。追加指示5）。
  source_type          TEXT NOT NULL,      -- データセット種別: 小=KSJ_A27_2023 / 中=KSJ_A32_2023
  source_version       TEXT NOT NULL,      -- 利用条件表の版: R5(=令和5年度版=2023年度版)。台帳と結合する版キー
  source_date          DATE,

  -- ライセンス列（台帳から非正規化して写す）。is_public の入力 3 列は NOT NULL + 安全側デフォルト。
  license_type         TEXT,
  license_url          TEXT,
  attribution_text     TEXT,
  raw_public           TEXT,
  raw_use              TEXT,
  special_condition    TEXT,
  commercial_use       BOOLEAN NOT NULL DEFAULT false,
  redistribution       BOOLEAN NOT NULL DEFAULT false,
  attribution_required BOOLEAN NOT NULL DEFAULT true,
  license_status       TEXT NOT NULL DEFAULT 'PENDING'
                         CHECK (license_status IN ('CLEARED', 'PENDING', 'REJECTED')),

  -- is_public = 最大の安全装置。式を変えない・入力列を nullable にしない。
  is_public            BOOLEAN GENERATED ALWAYS AS (
                         commercial_use = true
                         AND license_status = 'CLEARED'
                         AND (attribution_required = false OR attribution_text IS NOT NULL)
                       ) STORED,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 冪等 UPSERT のキー（版 × 自治体 × 学校種 × 学校）。
  UNIQUE (source_version, muni_code_5, school_type, school_key)
);

COMMENT ON TABLE public.school_districts IS
  'STEP2/SD-20: 学校区ポリゴン。ライセンス列は school_district_licenses から非正規化。is_public は生成列（安全装置）。プラン制限(Platinum)は本テーブルに入れず API 層 guardFeature + STEP4 で追加する。';
COMMENT ON COLUMN public.school_districts.is_public IS
  '生成列(STORED)。commercial_use=true AND license_status=CLEARED AND (attribution_required=false OR attribution_text IS NOT NULL)。is_public=false のポリゴンは API/タイルに一切含めない。';
COMMENT ON COLUMN public.school_districts.school_key IS
  'GENERATED: coalesce(nullif(school_code,''''), school_name)。SD-22 の 1学校1行統合の一意キー。';
COMMENT ON COLUMN public.school_districts.school_type IS
  'elementary / junior_high / compulsory。compulsory は器のみ（STEP2 では判定ロジック無し）。';
COMMENT ON COLUMN public.school_districts.source_type IS
  'データセット種別。KSJ_A27_2023(小学校区) / KSJ_A32_2023(中学校区)。source_version とは別概念。';
COMMENT ON COLUMN public.school_districts.source_version IS
  '国土数値情報 利用条件表の版。R5=令和5年度版=2023年度版。データセット種別ではない。school_district_licenses と (source_version, muni_code_5, school_type) で結合する版キー。版が更新(R6 等)されたら旧判定を自動継承せず、新条件表で再評価する。';

-- ── 台帳 → ポリゴンへライセンス列を写す BEFORE トリガー ──────────────────────
-- (source_version, muni_code_5, school_type) で台帳を引き、ライセンス列を NEW に写す。
-- 台帳に行が無い場合は写さない＝DEFAULT のまま(PENDING / commercial_use=false)＝deny-by-default。
-- 例外は投げず、NOTICE でログするに留める。
CREATE OR REPLACE FUNCTION public.sync_school_district_license()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lic public.school_district_licenses%ROWTYPE;
BEGIN
  SELECT *
    INTO v_lic
  FROM public.school_district_licenses l
  WHERE l.source_version = NEW.source_version
    AND l.muni_code_5    = NEW.muni_code_5
    AND l.school_type    = NEW.school_type;

  IF FOUND THEN
    NEW.license_status       := v_lic.license_status;
    NEW.license_type         := v_lic.license_type;
    NEW.license_url          := v_lic.license_url;
    NEW.attribution_text     := v_lic.attribution_text;
    NEW.raw_public           := v_lic.raw_public;
    NEW.raw_use              := v_lic.raw_use;
    NEW.special_condition    := v_lic.special_condition;
    NEW.commercial_use       := v_lic.commercial_use;
    NEW.redistribution       := v_lic.redistribution;
    NEW.attribution_required := v_lic.attribution_required;
    -- 台帳側にあれば参考コードも補完（ETL が NULL で入れてきた場合の保険）。
    NEW.muni_code_6          := coalesce(NEW.muni_code_6, v_lic.muni_code_6);
    NEW.pref_code            := coalesce(NEW.pref_code,   v_lic.pref_code);
    NEW.muni_name            := coalesce(NEW.muni_name,   v_lic.muni_name);
  ELSE
    -- deny-by-default: 台帳に行が無い。ライセンス列は DEFAULT のまま（PENDING）にする。
    RAISE NOTICE 'sync_school_district_license: no license row for (version=%, muni=%, type=%) -> deny-by-default (PENDING)',
      NEW.source_version, NEW.muni_code_5, NEW.school_type;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_school_district_license() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sync_school_district_license() TO service_role;

COMMENT ON FUNCTION public.sync_school_district_license() IS
  'STEP2: school_districts の BEFORE INSERT/UPDATE。台帳からライセンス列を NEW に写す。行が無ければ DEFAULT のまま(PENDING)＝deny-by-default。';

DROP TRIGGER IF EXISTS trg_sync_school_district_license ON public.school_districts;
CREATE TRIGGER trg_sync_school_district_license
  BEFORE INSERT OR UPDATE ON public.school_districts
  FOR EACH ROW EXECUTE FUNCTION public.sync_school_district_license();

-- ── 台帳更新 → ポリゴンへ伝播する AFTER トリガー（SD-15 の即日公開経路）──────────
-- 台帳の license_status 等が更新されたら、該当 school_districts 行のライセンス列を UPDATE する。
CREATE OR REPLACE FUNCTION public.propagate_school_district_license()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.school_districts sd
     SET license_status       = NEW.license_status,
         license_type         = NEW.license_type,
         license_url          = NEW.license_url,
         attribution_text     = NEW.attribution_text,
         raw_public           = NEW.raw_public,
         raw_use              = NEW.raw_use,
         special_condition    = NEW.special_condition,
         commercial_use       = NEW.commercial_use,
         redistribution       = NEW.redistribution,
         attribution_required = NEW.attribution_required,
         updated_at           = now()
   WHERE sd.source_version = NEW.source_version
     AND sd.muni_code_5    = NEW.muni_code_5
     AND sd.school_type    = NEW.school_type;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.propagate_school_district_license() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.propagate_school_district_license() TO service_role;

COMMENT ON FUNCTION public.propagate_school_district_license() IS
  'STEP2/SD-15: school_district_licenses の AFTER UPDATE。該当 school_districts 行へライセンス列を伝播（許諾取得時の即日公開経路）。is_public は生成列なので自動追随する。';

DROP TRIGGER IF EXISTS trg_propagate_school_district_license ON public.school_district_licenses;
-- ライセンス判定に関わる列が実際に変化したときだけ発火（ローダー再実行での全件伝播を防ぐ）。
-- updated_at は判定に含めない。
CREATE TRIGGER trg_propagate_school_district_license
  AFTER UPDATE ON public.school_district_licenses
  FOR EACH ROW
  WHEN (
    OLD.license_status       IS DISTINCT FROM NEW.license_status
    OR OLD.commercial_use       IS DISTINCT FROM NEW.commercial_use
    OR OLD.redistribution       IS DISTINCT FROM NEW.redistribution
    OR OLD.attribution_required IS DISTINCT FROM NEW.attribution_required
    OR OLD.attribution_text     IS DISTINCT FROM NEW.attribution_text
    OR OLD.license_type         IS DISTINCT FROM NEW.license_type
    OR OLD.license_url          IS DISTINCT FROM NEW.license_url
    OR OLD.raw_public           IS DISTINCT FROM NEW.raw_public
    OR OLD.raw_use              IS DISTINCT FROM NEW.raw_use
    OR OLD.special_condition    IS DISTINCT FROM NEW.special_condition
  )
  EXECUTE FUNCTION public.propagate_school_district_license();

-- ── 台帳 DELETE → ポリゴンを deny-by-default に戻す AFTER DELETE トリガー ──────
-- 台帳行が削除されたら、該当 school_districts 行のライセンス列を DEFAULT 相当へ戻す。
-- ⛔ school_districts 側の行は DELETE しない（ポリゴンは残し、非公開にするだけ）。
-- is_public は生成列なので自動的に false になる。
CREATE OR REPLACE FUNCTION public.propagate_school_district_license_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.school_districts sd
     SET license_status       = 'PENDING',
         commercial_use       = false,
         redistribution       = false,
         attribution_required = true,
         license_type         = NULL,
         license_url          = NULL,
         attribution_text     = NULL,
         raw_public           = NULL,
         raw_use              = NULL,
         special_condition    = NULL,
         updated_at           = now()
   WHERE sd.source_version = OLD.source_version
     AND sd.muni_code_5    = OLD.muni_code_5
     AND sd.school_type    = OLD.school_type;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.propagate_school_district_license_delete() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.propagate_school_district_license_delete() TO service_role;

COMMENT ON FUNCTION public.propagate_school_district_license_delete() IS
  'STEP2: school_district_licenses の AFTER DELETE。該当 school_districts 行のライセンス列を DEFAULT 相当(PENDING/commercial_use=false 等)へ戻す＝deny-by-default。ポリゴン行は削除しない（is_public は生成列で自動 false）。';

DROP TRIGGER IF EXISTS trg_propagate_school_district_license_delete ON public.school_district_licenses;
CREATE TRIGGER trg_propagate_school_district_license_delete
  AFTER DELETE ON public.school_district_licenses
  FOR EACH ROW EXECUTE FUNCTION public.propagate_school_district_license_delete();

-- ── インデックス ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS school_districts_geom_gist
  ON public.school_districts USING gist (geom);
CREATE INDEX IF NOT EXISTS school_districts_muni_type_idx
  ON public.school_districts (muni_code_5, school_type);
-- 公開行だけを引く経路（API/タイル）の高速化。
CREATE INDEX IF NOT EXISTS school_districts_public_idx
  ON public.school_districts (muni_code_5, school_type)
  WHERE is_public;

-- ── RLS: 公開行のみ authenticated が SELECT 可 ──────────────────────────────
-- ⚠️ プラン制限（Platinum 限定）は本 migration では入れない。
--    API 層の guardFeature('townAcquisitionPriority' 等) と STEP4 で追加する。
--    ここは is_public による公開/非公開の遮断のみを担う。
ALTER TABLE public.school_districts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_districts FROM anon, authenticated;
GRANT  SELECT ON public.school_districts TO authenticated;

-- SELECT: 公開ポリゴンのみ（is_public=false は一切返さない）。書き込みポリシーは作らない＝service_role のみ。
DROP POLICY IF EXISTS "school_districts_select_public" ON public.school_districts;
CREATE POLICY "school_districts_select_public" ON public.school_districts
  FOR SELECT TO authenticated
  USING (is_public = true);

-- INSERT/UPDATE/DELETE ポリシーは作らない（投入は service_role の ETL のみ）。
-- anon には GRANT しない。

COMMIT;

-- =====================================================================
-- 検証クエリ（適用後に手動実行 / scripts/sql/step2_verify.sql 参照）
--   -- 生成列と SRID/型:
--   SELECT DISTINCT ST_SRID(geom), GeometryType(geom) FROM public.school_districts;
--   -- 不正ジオメトリ 0 件:
--   SELECT count(*) FROM public.school_districts WHERE NOT ST_IsValid(geom);
--   -- is_public 内訳:
--   SELECT muni_name, school_type, is_public, count(*)
--   FROM public.school_districts GROUP BY 1,2,3 ORDER BY 1,2,3;
-- =====================================================================

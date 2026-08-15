-- =====================================================================
-- 20260814110000_step2_create_school_district_licenses.sql
-- STEP2 / SD-19・SD-20: 学校区データのライセンス台帳（R5 条件表由来）。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う。
--
-- 適用順（STEP2 全体）:
--   (1) 110000 school_district_licenses（本ファイル）
--   (2) 110100 school_districts（ポリゴン本体＋生成列＋同期トリガー）
--       ※ 110100 のトリガーが本テーブルを引くため、必ず本ファイルを先に適用する。
--   (3) scripts/etl/load_school_district_licenses.py（PO が dry-run → 本実行）
--   (4) scripts/etl/load_school_districts.py（PO が手動DLした KSJ を投入）
--
-- 適用条件（本ファイル）: 前提なし。STEP2 の最初に適用する。
--
-- 方針:
--   - 唯一の正は R5 条件表由来の CSV（docs/school_district_licenses_r5*.csv）。
--     版が変わったら旧判定を自動継承しない（PK に source_version を含める）。
--   - 判定単位は muni_code_5 × school_type（自治体単位でゲートすると誤公開する）。
--   - 条件表未収録の自治体は CSV に行が無い＝deny-by-default。補完しない。
--   - RLS は有効化するがポリシーは作らない＝ service_role のみ到達可能。
--     anon / authenticated には GRANT しない（バックヤード台帳）。
-- =====================================================================

BEGIN;

-- ── ライセンス台帳本体 ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.school_district_licenses (
  -- 判定キー: 版 × 自治体(5桁) × 学校種。版を PK に含め、版更新で旧判定を継承しない。
  source_version       TEXT NOT NULL,
  muni_code_5          TEXT NOT NULL,
  school_type          TEXT NOT NULL
                         CHECK (school_type IN ('elementary', 'junior_high', 'compulsory')),

  -- 参考情報（CSV から写す）。
  muni_code_6          TEXT,
  pref_code            TEXT,
  muni_name            TEXT,
  source_type          TEXT,               -- 小=KSJ_A27_2023 / 中=KSJ_A32_2023
  source_date          DATE,

  -- ライセンス判定。デフォルトは必ず PENDING（推測で CLEARED にしない）。
  license_status       TEXT NOT NULL DEFAULT 'PENDING'
                         CHECK (license_status IN ('CLEARED', 'PENDING', 'REJECTED')),
  license_type         TEXT,
  license_url          TEXT,
  source_url           TEXT,

  -- is_public の入力になる 3 列。NOT NULL + 安全側デフォルト。
  commercial_use       BOOLEAN NOT NULL DEFAULT false,
  redistribution       BOOLEAN NOT NULL DEFAULT false,
  attribution_required BOOLEAN NOT NULL DEFAULT true,

  -- クレジット文言・原文・特記。
  attribution_text     TEXT,
  raw_public           TEXT,
  raw_use              TEXT,
  special_condition    TEXT,

  -- 条件表を確認した日付。
  checked_at           DATE,
  is_priority_target   BOOLEAN NOT NULL DEFAULT false,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (source_version, muni_code_5, school_type)
);

COMMENT ON TABLE public.school_district_licenses IS
  'STEP2/SD-19: 学校区データのライセンス台帳。R5 条件表由来。版(source_version)が変わったら旧判定を自動継承しない（PK に版を含む）。判定は muni_code_5 × school_type 単位。行が無い自治体は deny-by-default。';

COMMENT ON COLUMN public.school_district_licenses.muni_code_6 IS
  '全国地方公共団体コード6桁。CSV の muni_code_6 をそのまま保持（検査数字は計算しない）。';
COMMENT ON COLUMN public.school_district_licenses.source_version IS
  '国土数値情報 利用条件表の版。R5=令和5年度版=2023年度版。データセット種別ではない。PK に含み、版が更新(R6 等)されたら旧判定を自動継承しない。';
COMMENT ON COLUMN public.school_district_licenses.source_type IS
  'データセット種別。KSJ_A27_2023(小学校区) / KSJ_A32_2023(中学校区)。source_version とは別概念。';
COMMENT ON COLUMN public.school_district_licenses.license_status IS
  '判定。DEFAULT PENDING。CLEARED/PENDING/REJECTED のみ。推測で CLEARED にしない。';

-- ── RLS: 有効化のみ。ポリシーは作らない＝ service_role のみ到達可能 ──────────
ALTER TABLE public.school_district_licenses ENABLE ROW LEVEL SECURITY;

-- 既定の広い付与を剥奪。anon / authenticated には一切 GRANT しない（バックヤード台帳）。
REVOKE ALL ON public.school_district_licenses FROM anon, authenticated;

COMMIT;

-- =====================================================================
-- 検証クエリ（適用後に手動実行）
--   -- テーブル/RLS 有効:
--   SELECT relname, relrowsecurity FROM pg_class
--   WHERE oid = 'public.school_district_licenses'::regclass;
--   -- ポリシーが 0 件であること（service_role のみ到達）:
--   SELECT count(*) FROM pg_policies
--   WHERE schemaname='public' AND tablename='school_district_licenses';
--   -- anon/authenticated に権限が無いこと:
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_schema='public' AND table_name='school_district_licenses';
-- =====================================================================

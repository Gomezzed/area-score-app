-- =====================================================================
-- 20260628000100_create_public_town_monthly_metrics.sql  (T3)
--
-- 目的:
--   製品側(public)の「町域×月次」正データテーブルを新規作成する。
--   バックヤード iwakuni.town_monthly_metrics（service_role 専用・正データ）の
--   カラム構成をミラーしつつ、製品側に流す確定差分＋ルールベース推定スコアを
--   1行に保持する。RLS を有効化し SELECT は platinum 限定。
--
-- 設計原則（CLAUDE.md §4）の反映:
--   原則1: 確定(事実)と推定(スコア)を絶対に混ぜない。
--          → 列名で明確に分離する。confirmed_* = 公表値ベースの確定差分、
--            inferred_*  = ルールベース推定スコア。inferred_reason に算出根拠。
--   原則2: 全国地方公共団体コード6桁を背骨に。muni_code を必須キーに含め、
--          municipality_id(uuid) で public.municipalities へ橋渡し。
--   原則3: 同名異町域があるため office_name(出張所/支所)を必ず保持する。
--   原則4: 同一(町域,時点)は UPSERT で上書き可。→ PK=(muni_code,town_id,as_of)。
--   原則5: 物件特定・断定はしない。本テーブルは確定差分＋推定スコアまで。
--
-- 無損失グレイン: (muni_code, town_id, as_of) を一意キー（＝主キー）。
--   iwakuni.town_monthly_metrics と同一グレイン。
--
-- 前提: public.current_user_plan() が先行 migration
--       (20260628000000) で作成済みであること。
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.town_monthly_metrics (
  -- ── 識別子 / ディメンション ──────────────────────────────────────
  -- 背骨: public.municipalities への橋渡し（iwakuni.municipality.public_municipality_id 由来）
  municipality_id               uuid    NOT NULL
                                  REFERENCES public.municipalities(id) ON DELETE CASCADE,
  muni_code                     text    NOT NULL,   -- 全国地方公共団体コード6桁（原則2）
  town_id                       bigint  NOT NULL,
  as_of                         date    NOT NULL,
  office_name                   text,               -- 出張所/支所（原則3・同名異町域の一意化）
  town_name                     text    NOT NULL,   -- 正規化町名
  town_name_raw                 text,               -- 原表記（参考）
  lat                           double precision,
  lng                           double precision,

  -- ── 確定（事実）: 公表値ベースの実数・差分。原則1 で推定と混ぜない ──
  confirmed_households          integer,
  confirmed_population          integer,
  confirmed_persons_per_hh      numeric,
  confirmed_households_mom_delta  integer,
  confirmed_households_3m_delta   integer,
  confirmed_households_6m_delta   integer,
  confirmed_households_yoy_delta  integer,
  confirmed_population_mom_delta  integer,
  confirmed_population_3m_delta   integer,
  confirmed_population_6m_delta   integer,
  confirmed_population_yoy_delta  integer,
  confirmed_age_0_14_delta      integer,
  confirmed_age_20_39_delta     integer,
  confirmed_age_30_49_delta     integer,
  confirmed_age_65_plus_ratio   numeric,

  -- ── 推定（スコア）: ルールベース推定。必ず inferred_reason を伴う（原則1）──
  inferred_demand_score         numeric,   -- 需要スコア
  inferred_sell_signal_score    numeric,   -- 売却発生スコア
  inferred_supply_event_score   numeric,   -- 供給イベントスコア
  inferred_acquisition_score    numeric,   -- 取得優先スコア（acquisition）
  inferred_priority_rank        text,      -- S/A/B/C/D
  inferred_reason               text,      -- 推定の算出根拠（原則1: 推定には必ず根拠）

  -- ── プロベナンス ───────────────────────────────────────────────
  source_computed_at            timestamptz,                  -- iwakuni 側の計算時刻（computed_at）
  synced_at                     timestamptz NOT NULL DEFAULT now(), -- public へ同期した時刻

  CONSTRAINT town_monthly_metrics_pkey
    PRIMARY KEY (muni_code, town_id, as_of),
  CONSTRAINT town_monthly_metrics_priority_rank_chk
    CHECK (inferred_priority_rank IS NULL
           OR inferred_priority_rank IN ('S', 'A', 'B', 'C', 'D')),
  -- 原則1: 推定(ランク)は必ず算出根拠(reason)を伴う。根拠なしの「裸の推定」を
  --        構造的に禁止する（=製品に出る推定は必ず説明可能）。実データ全件で充足を確認済。
  CONSTRAINT town_monthly_metrics_inferred_reason_chk
    CHECK (inferred_priority_rank IS NULL OR inferred_reason IS NOT NULL)
);

-- ── インデックス ─────────────────────────────────────────────────
-- 自治体×時点での絞り込み（ダッシュボード/最新月の取得）
CREATE INDEX IF NOT EXISTS town_monthly_metrics_muni_asof_idx
  ON public.town_monthly_metrics (municipality_id, as_of);
-- 自治体×時点×ランクでの優先町域抽出（platinum 町域取得優先ビュー）
CREATE INDEX IF NOT EXISTS town_monthly_metrics_muni_rank_idx
  ON public.town_monthly_metrics (municipality_id, as_of, inferred_priority_rank);

-- ── テーブル/列コメント（確定/推定の境界を明示）────────────────────
COMMENT ON TABLE public.town_monthly_metrics IS
  '町域×月次の製品側正データ。iwakuni.town_monthly_metrics のミラー。'
  'confirmed_* = 確定(公表値ベース差分) / inferred_* = ルールベース推定スコア。'
  'グレイン=(muni_code, town_id, as_of)。RLS: SELECT は platinum のみ。';
COMMENT ON COLUMN public.town_monthly_metrics.municipality_id IS '背骨: public.municipalities.id への FK（橋渡し）';
COMMENT ON COLUMN public.town_monthly_metrics.muni_code IS '全国地方公共団体コード6桁（原則2）';
COMMENT ON COLUMN public.town_monthly_metrics.office_name IS '出張所/支所。同名異町域の一意化に必須（原則3）';
COMMENT ON COLUMN public.town_monthly_metrics.inferred_priority_rank IS '推定: 取得優先ランク S/A/B/C/D';
COMMENT ON COLUMN public.town_monthly_metrics.inferred_reason IS '推定スコアの算出根拠（原則1: 推定は必ず根拠を伴う）';

-- ── RLS ─────────────────────────────────────────────────────────
ALTER TABLE public.town_monthly_metrics ENABLE ROW LEVEL SECURITY;

-- SELECT は platinum プランのユーザーのみ（許可判定は current_user_plan に集約）
DROP POLICY IF EXISTS "platinum reads town metrics" ON public.town_monthly_metrics;
CREATE POLICY "platinum reads town metrics"
  ON public.town_monthly_metrics
  FOR SELECT
  TO authenticated
  USING (public.current_user_plan() = 'platinum');

-- 書き込みは service_role のみ（同期関数が service_role で実行）。
-- service_role は RLS をバイパスするため実質ノーオペだが、意図を明示する。
DROP POLICY IF EXISTS "service_role writes town metrics" ON public.town_monthly_metrics;
CREATE POLICY "service_role writes town metrics"
  ON public.town_monthly_metrics
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON POLICY "platinum reads town metrics" ON public.town_monthly_metrics IS
  'platinum プランのみ SELECT 可。anon/非platinum authenticated は 0 行。';

-- ── テーブル権限の最小化（多層防御）─────────────────────────────────
-- Supabase 既定では public スキーマの新規テーブルに anon/authenticated へ全権限が
-- 自動付与される。本テーブルは platinum 限定の機密データのため、書き込み権限を剥奪し
-- SELECT のみ残す。行の可視性は RLS が制御するため anon/非platinum は 0 行のまま
-- （権限エラーではなく「RLS で 0 行」の挙動を維持）。書き込みは service_role（同期関数）経由のみ。
REVOKE ALL    ON public.town_monthly_metrics FROM anon, authenticated;
GRANT  SELECT ON public.town_monthly_metrics TO   anon, authenticated;

COMMIT;

-- =====================================================================
-- 検証クエリ（適用後に手動実行）
--   -- RLS 有効:
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.town_monthly_metrics'::regclass;
--   -- ポリシー（platinum SELECT / service_role ALL の2件）:
--   SELECT policyname, roles, cmd, qual
--   FROM pg_policies WHERE schemaname='public' AND tablename='town_monthly_metrics';
-- =====================================================================

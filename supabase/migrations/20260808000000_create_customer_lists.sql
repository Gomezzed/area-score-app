-- =====================================================================
-- 20260808000000_create_customer_lists.sql  (D24 STEP1 / 自社顧客リスト連携)
--
-- 目的:
--   Platinum ユーザーが自社の反響顧客名簿(CSV)を取り込むための2テーブルを新規作成。
--     - customer_lists      … 取り込んだ名簿1本のメタ情報（列マッピング等）
--     - customer_list_rows  … 名簿の各行（住所→町域 突合結果を含む）
--
-- 設計原則（CLAUDE.md §4 / D25）の反映:
--   D25 (ID単位分離・絶対条件): 両テーブル RLS 有効。authenticated は
--       auth.uid() = user_id の行のみ SELECT/INSERT/UPDATE/DELETE 可。
--       他人の顧客名簿には行レベルで一切到達できない。
--   原則1/5 (確定と推定を混ぜない / 断定しない):
--       突合結果は match_status(confirmed/ambiguous/out_of_scope) で3値管理し、
--       推測での一致は残さない。取得優先ランクは本テーブルに保存せず、
--       表示時に public.town_monthly_metrics を join して最新値を出す
--       （＝スナップショットの陳腐化を防ぎ、事実の単一出所を保つ）。
--   個人情報の最小化 (PO判断): 電話番号は取り込むが保存しない（列を持たない）。
--
-- 停止条項: 本 migration は「作成のみ」。DB への適用は PR マージ後に PO が行う。
--           （#16 で DB がコードに先行した反省を踏まえ、コード先行で適用しない）
-- =====================================================================

BEGIN;

-- ── 名簿本体 ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_lists (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,                       -- 名簿の表示名（ファイル名等）
  source_type    TEXT NOT NULL DEFAULT 'csv'
                   CHECK (source_type IN ('csv')),     -- 取込元。STEP1 は csv のみ
  row_count      INTEGER NOT NULL DEFAULT 0,           -- 取り込んだ行数
  column_mapping JSONB,                                -- 検出した列マッピング（CSVヘッダ→論理列）
  imported_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_lists_user_idx
  ON public.customer_lists (user_id, imported_at DESC);

-- ── 名簿の各行（住所→町域 突合結果を含む）───────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_list_rows (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id               UUID NOT NULL
                          REFERENCES public.customer_lists(id) ON DELETE CASCADE,
  -- user_id を各行にも持たせ RLS を行単位で自己完結させる（join に依存しない多層防御）。
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  row_no                INTEGER NOT NULL,              -- CSV上の行番号（1始まり・ヘッダ除く）

  -- ── 顧客情報（電話番号は保存しない＝列を持たない・個人情報の最小化）──
  customer_name         TEXT,
  address_raw           TEXT,                          -- 取り込んだ原文住所
  address_normalized    TEXT,                          -- 正規化後の住所（突合の入力）

  -- ── 住所→町域 突合結果 ───────────────────────────────────────────
  municipality_id       UUID REFERENCES public.municipalities(id) ON DELETE SET NULL,
  town_name_normalized  TEXT,                          -- 一意確定した町域名（正規化）。表示時に metrics へ join
  match_status          TEXT NOT NULL DEFAULT 'out_of_scope'
                          CHECK (match_status IN ('confirmed', 'ambiguous', 'out_of_scope')),
  match_candidates      JSONB,                         -- ambiguous 時の候補（town_id/office_name 等）を保持

  -- ── 名簿の付帯情報 ───────────────────────────────────────────────
  inquiry_at            TIMESTAMPTZ,                   -- 反響日時
  last_contact_at       TIMESTAMPTZ,                   -- 最終接触日（アタックリストの副ソートキー）
  media                 TEXT,                          -- 反響媒体
  category              TEXT,                          -- 種別
  assignee              TEXT,                          -- 担当

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_list_rows_list_idx
  ON public.customer_list_rows (list_id, row_no);
CREATE INDEX IF NOT EXISTS customer_list_rows_user_idx
  ON public.customer_list_rows (user_id);
-- アタックリスト join（municipality_id × 町域名）用
CREATE INDEX IF NOT EXISTS customer_list_rows_match_idx
  ON public.customer_list_rows (municipality_id, town_name_normalized);

-- ── コメント（意図の明示）────────────────────────────────────────────
COMMENT ON TABLE public.customer_lists IS
  'D24: Platinum ユーザーの反響顧客名簿(CSV)のメタ情報。RLS: 自分の行のみ。';
COMMENT ON TABLE public.customer_list_rows IS
  'D24: 顧客名簿の各行＋住所→町域 突合結果。電話番号は保存しない（個人情報最小化）。'
  '取得優先ランクは保存せず表示時に town_monthly_metrics を join（事実の単一出所）。';
COMMENT ON COLUMN public.customer_list_rows.match_status IS
  '3値: confirmed(一意) / ambiguous(候補複数→match_candidates) / out_of_scope(町域データ未整備)';
COMMENT ON COLUMN public.customer_list_rows.town_name_normalized IS
  'confirmed 時の一意町域名（正規化）。(municipality_id, town_name_normalized) で metrics へ join';

-- ── RLS（D25: ID単位分離は絶対条件）──────────────────────────────────
ALTER TABLE public.customer_lists     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_list_rows ENABLE ROW LEVEL SECURITY;

-- customer_lists: authenticated は自分の行のみ CRUD 可。
DROP POLICY IF EXISTS "cl_select_own" ON public.customer_lists;
CREATE POLICY "cl_select_own" ON public.customer_lists
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "cl_insert_own" ON public.customer_lists;
CREATE POLICY "cl_insert_own" ON public.customer_lists
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "cl_update_own" ON public.customer_lists;
CREATE POLICY "cl_update_own" ON public.customer_lists
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "cl_delete_own" ON public.customer_lists;
CREATE POLICY "cl_delete_own" ON public.customer_lists
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- customer_list_rows: authenticated は自分の行のみ CRUD 可。
DROP POLICY IF EXISTS "clr_select_own" ON public.customer_list_rows;
CREATE POLICY "clr_select_own" ON public.customer_list_rows
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "clr_insert_own" ON public.customer_list_rows;
CREATE POLICY "clr_insert_own" ON public.customer_list_rows
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "clr_update_own" ON public.customer_list_rows;
CREATE POLICY "clr_update_own" ON public.customer_list_rows
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "clr_delete_own" ON public.customer_list_rows;
CREATE POLICY "clr_delete_own" ON public.customer_list_rows
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ── テーブル権限の最小化（多層防御）─────────────────────────────────
-- 既定の anon への全権限付与を剥奪。anon は一切到達不可（機密＝顧客個人情報）。
-- authenticated は RLS 下でのみ自分の行を操作。service_role は RLS バイパス（管理用途）。
REVOKE ALL ON public.customer_lists     FROM anon, authenticated;
REVOKE ALL ON public.customer_list_rows FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_lists     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_list_rows TO authenticated;

-- ── 突合 / ランク join 用ビュー（自治体ごとの最新 as_of のみ）──────────────
-- ⚠ 自治体ごとに最新 as_of はバラバラ（実測: 刈谷/安城/知立=2026-07 / 岡崎/岩国=2026-06 /
--   神戸9区=2026-05 / 西宮/一宮=2026-04 / 姫路/鹿児島=2026-03 …）。
--   グローバル最大月で絞ると、遅れている自治体（岡崎など）の町域が0件になり主用途が全滅する。
--   → (municipality_id, max(as_of)) の組で「各自治体の最新月」のみを抽出する。
-- security_invoker=on: 呼び出し元（platinum authenticated）の RLS を継承する。
--   非platinum は基表 town_monthly_metrics の RLS により 0 行（アプリ側 guard と二層防御）。
CREATE OR REPLACE VIEW public.customer_list_town_latest
  WITH (security_invoker = on) AS
  SELECT t.municipality_id,
         m.name AS municipality_name,
         t.town_id,
         t.town_name,
         t.town_name_raw,
         t.office_name,
         t.as_of,
         t.inferred_priority_rank,
         t.inferred_reason
  FROM public.town_monthly_metrics t
  JOIN public.municipalities m ON m.id = t.municipality_id
  JOIN (
    SELECT municipality_id, max(as_of) AS as_of
    FROM public.town_monthly_metrics
    GROUP BY municipality_id
  ) latest
    ON latest.municipality_id = t.municipality_id
   AND latest.as_of = t.as_of;

COMMENT ON VIEW public.customer_list_town_latest IS
  'D24 突合/ランク join 用。自治体ごとの最新 as_of の町域行のみを返す。'
  'security_invoker で基表 town_monthly_metrics の RLS(platinum 限定) を継承。';

-- anon には出さない。platinum 判定は基表 RLS が担う（authenticated へ SELECT のみ付与）。
GRANT SELECT ON public.customer_list_town_latest TO authenticated;

COMMIT;

-- =====================================================================
-- 検証クエリ（適用後に手動実行）
--   -- RLS 有効:
--   SELECT relname, relrowsecurity FROM pg_class
--   WHERE oid IN ('public.customer_lists'::regclass, 'public.customer_list_rows'::regclass);
--   -- ポリシー（各テーブル SELECT/INSERT/UPDATE/DELETE の4件）:
--   SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE schemaname='public' AND tablename IN ('customer_lists','customer_list_rows')
--   ORDER BY tablename, cmd;
-- =====================================================================

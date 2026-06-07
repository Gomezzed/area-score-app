-- ============================================================================
--  20260607000003_enable_rls_existing_tables.sql
--  既存 6 テーブルに RLS を有効化し、認証済ユーザーに SELECT 権限を付与する。
--  非適用だった supabase/migrations/20260606_enable_rls.sql を統合・拡張した版。
--
--  posture:
--    - SELECT は authenticated のみ (proxy.ts が未認証を /login にリダイレクト
--      するため anon ロールでアクセスが来ることは想定外)
--    - INSERT/UPDATE/DELETE はポリシー無し = service_role キーのみ可能
--    - subscriptions, towns 等は対象外 (各自で適切に設定済 or 別マイグレで)
-- ============================================================================

BEGIN;

-- ── Phase 1: RLS 有効化 ────────────────────────────────────────────────────
ALTER TABLE public.cities                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.areas                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prefectures              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.municipalities           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.population_stats         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.real_estate_transactions ENABLE ROW LEVEL SECURITY;

-- ── Phase 2: SELECT ポリシー (authenticated のみ) ──────────────────────────
DROP POLICY IF EXISTS "authenticated read cities" ON public.cities;
CREATE POLICY "authenticated read cities"
  ON public.cities FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "authenticated read areas" ON public.areas;
CREATE POLICY "authenticated read areas"
  ON public.areas FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "authenticated read prefectures" ON public.prefectures;
CREATE POLICY "authenticated read prefectures"
  ON public.prefectures FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "authenticated read municipalities" ON public.municipalities;
CREATE POLICY "authenticated read municipalities"
  ON public.municipalities FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "authenticated read population_stats" ON public.population_stats;
CREATE POLICY "authenticated read population_stats"
  ON public.population_stats FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "authenticated read real_estate_transactions" ON public.real_estate_transactions;
CREATE POLICY "authenticated read real_estate_transactions"
  ON public.real_estate_transactions FOR SELECT
  TO authenticated
  USING (true);

-- ── Phase 3: コメント ─────────────────────────────────────────────────────
COMMENT ON POLICY "authenticated read cities" ON public.cities IS
  '認証済ユーザーのみ SELECT 可。書き込みは service_role キー限定。';
COMMENT ON POLICY "authenticated read areas" ON public.areas IS
  '認証済ユーザーのみ SELECT 可。書き込みは service_role キー限定。';
COMMENT ON POLICY "authenticated read prefectures" ON public.prefectures IS
  '認証済ユーザーのみ SELECT 可。書き込みは service_role キー限定。';
COMMENT ON POLICY "authenticated read municipalities" ON public.municipalities IS
  '認証済ユーザーのみ SELECT 可。書き込みは service_role キー限定。';
COMMENT ON POLICY "authenticated read population_stats" ON public.population_stats IS
  '認証済ユーザーのみ SELECT 可。書き込みは service_role キー限定。';
COMMENT ON POLICY "authenticated read real_estate_transactions" ON public.real_estate_transactions IS
  '認証済ユーザーのみ SELECT 可。書き込みは service_role キー限定。';

COMMIT;

-- ============================================================================
-- 検証クエリ (適用後に手動で実行)
-- ============================================================================
-- 1. rowsecurity = true 確認:
--    SELECT tablename, rowsecurity FROM pg_tables
--    WHERE schemaname='public'
--      AND tablename IN ('cities','areas','prefectures','municipalities',
--                        'population_stats','real_estate_transactions');
--
-- 2. ポリシー一覧 (6 行、authenticated のみ):
--    SELECT tablename, policyname, roles, cmd FROM pg_policies
--    WHERE schemaname='public'
--      AND tablename IN ('cities','areas','prefectures','municipalities',
--                        'population_stats','real_estate_transactions');
--
-- 3. ブラウザ /dashboard リロードで UI 動作確認
--    (proxy.ts が /login にリダイレクトしている前提なので、ログイン済セッション
--     なら従来通りデータ表示されるはず)
-- ============================================================================

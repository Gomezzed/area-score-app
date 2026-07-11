-- =====================================================================
-- 20260704000000_restrict_stations_rls.sql  (T9b / stations RLS絞り込み)
--
-- 目的:
--   public.stations の SELECT を「standard または platinum の有効契約者」に
--   限定する。T9（駅単位ドリルダウン）時点では authenticated 全行開放
--   （qual=true・20260610120000）だったが、駅単位データは料金v2.1で
--   Standard 以上の有料機能のため、アプリ層 guardFeature('stationLevelEntitled')
--   （/api/stations）に加えて DB層(RLS) でも同じ境界を張る
--   （UI/API/DB 3層が plans.ts の定義を参照する構成・CLAUDE.md §3）。
--
-- 前提:
--   - public.current_user_plan() が 20260628000000 で作成済みであること。
--   - stations の直SELECTはサーバー Route Handler /api/stations の1本のみ
--     （認証ユーザー文脈・guardFeature で standard+ 限定）。クライアントからの
--     supabase 直クエリは 0 件のため、本絞り込みで壊れる既存動作は無い
--     （2026/7/4 調査済み）。
--
-- 判定ロジック:
--   town_monthly_metrics（20260628000100）の platinum 限定 SELECT ポリシーと
--   同方式。プラン判定は public.current_user_plan() に集約する
--   （許可判定の単一入口。プラン名の直書き分岐をポリシー内に増やさない）。
-- =====================================================================

BEGIN;

-- 旧ポリシー（authenticated 全行開放・20260610120000 で作成）を撤去
DROP POLICY IF EXISTS "authenticated read stations" ON public.stations;

-- SELECT は standard / platinum の有効契約者のみ
DROP POLICY IF EXISTS stations_read_standard_plus ON public.stations;
CREATE POLICY stations_read_standard_plus
  ON public.stations
  FOR SELECT
  TO authenticated
  USING (public.current_user_plan() IN ('standard', 'platinum'));

COMMENT ON POLICY stations_read_standard_plus ON public.stations IS
  'standard/platinum プランのみ SELECT 可。anon/free/starter は 0 行。'
  'プラン判定は public.current_user_plan() に集約（town_monthly_metrics と同方式）。';

-- 書き込みは service_role のみ（ETL/データ投入が service_role キーで実行）。
-- service_role は RLS をバイパスするため実質ノーオペだが、意図を明示する
-- （town_monthly_metrics の service_role ポリシーと同じ形）。
DROP POLICY IF EXISTS "service_role writes stations" ON public.stations;
CREATE POLICY "service_role writes stations"
  ON public.stations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── テーブル権限の最小化（多層防御・town_monthly_metrics 20260628000100 と同じ形）──
-- Supabase 既定の全権限グラントから書き込み権限を剥奪し SELECT のみ残す。
-- 行の可視性は RLS が制御するため、anon/非standard+ は権限エラーではなく
-- 「RLS で 0 行」の挙動を維持する。書き込みは service_role（ETL/データ投入）経由のみ。
REVOKE ALL    ON public.stations FROM anon, authenticated;
GRANT  SELECT ON public.stations TO   anon, authenticated;

COMMIT;

-- =====================================================================
-- 検証クエリ（適用後に手動実行）
--   -- RLS が有効のままであること:
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.stations'::regclass;
--
--   -- ポリシーが standard+ SELECT / service_role ALL の2件のみで、
--   -- 旧 "authenticated read stations" が残っていないこと:
--   SELECT policyname, roles, cmd, qual
--   FROM pg_policies WHERE schemaname='public' AND tablename='stations';
--
--   -- free アカウントの authenticated 文脈で 0 行になること（アプリ経由で確認）。
--   -- standard/platinum アカウントでは従来どおり取得できること。
-- =====================================================================

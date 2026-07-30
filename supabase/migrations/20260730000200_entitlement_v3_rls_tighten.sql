-- =====================================================================
-- 20260730000200_entitlement_v3_rls_tighten.sql
-- エンタイトルメント v3 / RLS 締め（2b・restrictive）
--
-- expand-contract の "contract" フェーズ:
--   ⚠ この migration は「アプリを RPC 経由へ切替済み・本番デプロイ Ready」に
--     なってからのみ適用すること。先に当てると、旧アプリ(テーブル直読み)の
--     free ユーザー画面が全件空になるブラックアウト窓が生じる。
--   前提: 20260730000000（構造列）と 20260730000100（RPC）が適用済み。
--
-- 変更内容: census 本体を Free 直読み不可に締める（RPC が唯一の入口になる）。
--   - municipalities / population_stats : authenticated SELECT を
--     USING(true) → USING(current_user_plan() <> 'free')
--   - real_estate_transactions          : USING(true) → starter 以上
--   ※ compare/trade-area は platinum(=<>'free') かつ guardFeature 後段のため通る。
--   ※ anon の SELECT は元々不可（authenticated ロールのみポリシー）。
--
-- ⚠ ポリシー名ドリフト対策（レビュー指摘）:
--   本 DB では cities/areas に重複ポリシー(*_read_authenticated)のドリフトが実在する。
--   固定名の DROP は本番の実名と食い違うと空振りし、旧 USING(true) が残存 → permissive は
--   OR 合成のため free 遮断が「無音で」無効化される（H1が閉じない）。
--   そこで:
--     (B-1) 対象3表の SELECT ポリシーを名前に依存せず全削除（プログラム的 DROP）。
--     (B-2) 新ポリシーを1本ずつ CREATE。
--     (B-3) COMMIT 直前の自己検証で「authenticated 向け SELECT がちょうど1本」かつ
--           「qual='true' のポリシーが0本」でなければ RAISE EXCEPTION で全体を中断。
-- =====================================================================

BEGIN;

-- (B-1) 対象3表の既存 SELECT ポリシーを名前非依存で全削除（旧名・ドリフト名を網羅）
--   反復中の catalog 変化を避けるため、対象名を先に配列へ集めてから DROP する。
DO $$
DECLARE
  rows text[][];
  i    int;
BEGIN
  SELECT coalesce(array_agg(ARRAY[tablename, policyname]), '{}')
  INTO rows
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('municipalities','population_stats','real_estate_transactions')
    AND cmd = 'SELECT';

  IF rows IS NOT NULL THEN
    FOR i IN 1 .. coalesce(array_length(rows, 1), 0) LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', rows[i][2], rows[i][1]);
    END LOOP;
  END IF;
END $$;

-- (B-2) 新 SELECT ポリシーを1本ずつ作成
CREATE POLICY "authenticated read municipalities"
  ON public.municipalities FOR SELECT
  TO authenticated
  USING (public.current_user_plan() <> 'free');
COMMENT ON POLICY "authenticated read municipalities" ON public.municipalities IS
  'free 以外のみ直 SELECT 可。free は get_municipalities_gated 経由のみ。書き込みは service_role。';

CREATE POLICY "authenticated read population_stats"
  ON public.population_stats FOR SELECT
  TO authenticated
  USING (public.current_user_plan() <> 'free');
COMMENT ON POLICY "authenticated read population_stats" ON public.population_stats IS
  'free 以外のみ直 SELECT 可。free は RPC 経由のみ。書き込みは service_role。';

CREATE POLICY "authenticated read real_estate_transactions"
  ON public.real_estate_transactions FOR SELECT
  TO authenticated
  USING (public.current_user_plan() IN ('starter','standard','platinum'));
COMMENT ON POLICY "authenticated read real_estate_transactions" ON public.real_estate_transactions IS
  'starter 以上のみ直 SELECT 可（マンション取引履歴）。free は取得不可。書き込みは service_role。';

-- (B-3) 自己検証: 各表で authenticated SELECT がちょうど1本・qual='true' が0本でなければ中断
DO $$
DECLARE
  t          text;
  v_sel      int;   -- 当該表の SELECT ポリシー総数
  v_auth_sel int;   -- うち authenticated 向け
  v_true     int;   -- qual='true'（＝素通し）のポリシー数（cmd 不問）
BEGIN
  FOREACH t IN ARRAY ARRAY['municipalities','population_stats','real_estate_transactions'] LOOP
    SELECT count(*) INTO v_sel
      FROM pg_policies WHERE schemaname='public' AND tablename=t AND cmd='SELECT';
    SELECT count(*) INTO v_auth_sel
      FROM pg_policies WHERE schemaname='public' AND tablename=t AND cmd='SELECT'
        AND 'authenticated' = ANY(roles);
    SELECT count(*) INTO v_true
      FROM pg_policies WHERE schemaname='public' AND tablename=t AND qual='true';

    IF v_sel <> 1 THEN
      RAISE EXCEPTION 'RLS guard: % has % SELECT policies (expected exactly 1)', t, v_sel;
    END IF;
    IF v_auth_sel <> 1 THEN
      RAISE EXCEPTION 'RLS guard: % has % authenticated SELECT policies (expected 1)', t, v_auth_sel;
    END IF;
    IF v_true <> 0 THEN
      RAISE EXCEPTION 'RLS guard: % still has % USING(true) policy — free bypass not closed', t, v_true;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- =====================================================================
-- 検証クエリ（適用後 / SQL Editor は service_role 文脈＝current_user_plan()='free'）
-- ---------------------------------------------------------------------
-- (V7) RLS ポリシー全行ダンプ（適用 前/後 を比較。qual='true' が消え current_user_plan に）:
--   SELECT tablename, policyname, permissive, roles, cmd, qual
--   FROM pg_policies
--   WHERE schemaname='public'
--     AND tablename IN ('municipalities','population_stats','real_estate_transactions')
--   ORDER BY tablename, cmd, policyname;
--   -- before: 3表とも 1本ずつ qual='true'
--   -- after : 3表とも 1本ずつ、municipalities/population_stats は
--   --         qual=(current_user_plan() <> 'free')、real_estate_transactions は
--   --         qual=(current_user_plan() = ANY('{starter,standard,platinum}'))。true は0本。
--
-- ロールバック（逆SQL）: RLS を USING(true) に戻す（RPC はそのまま残してよい）
--   DROP POLICY IF EXISTS "authenticated read municipalities" ON public.municipalities;
--   CREATE POLICY "authenticated read municipalities" ON public.municipalities
--     FOR SELECT TO authenticated USING (true);
--   DROP POLICY IF EXISTS "authenticated read population_stats" ON public.population_stats;
--   CREATE POLICY "authenticated read population_stats" ON public.population_stats
--     FOR SELECT TO authenticated USING (true);
--   DROP POLICY IF EXISTS "authenticated read real_estate_transactions" ON public.real_estate_transactions;
--   CREATE POLICY "authenticated read real_estate_transactions" ON public.real_estate_transactions
--     FOR SELECT TO authenticated USING (true);
-- =====================================================================

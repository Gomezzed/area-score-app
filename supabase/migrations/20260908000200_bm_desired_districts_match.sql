-- =====================================================================
-- 20260908000200_bm_desired_districts_match.sql
-- 購入希望マッチ（BM）PR-BM-1 / c2: 希望校区（小学校）名寄せの受け皿と関数。
--   決定: Vault 2026-09-03_Decision_購入希望マッチ設計（仮番 -bm-）。設計書 §9 参照。
--   ⚠ -bm- は「仮番」。本 migration で仮番を新設・変更・採番しない。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う（R7・D57）。
--   ※ supabase db push は恒久禁止。
--   ※ 20260908000100_bm_property_types_lead_type.sql を先に適用すること
--     （子テーブルの所有情報トリガーが set_customer_list_row_child_owner() を参照し、
--       名寄せ RPC が customer_list_rows.lead_type を参照するため）。
--
-- 本 migration が作るもの:
--   (5) public.normalize_school_name(text)                      … 校名の名寄せ用正規化（両辺に適用・冪等）
--   (4) public.customer_list_row_desired_districts              … 買い行×希望校区の名寄せ結果（洗い替え）
--   (6) public.match_customer_list_desired_districts(uuid)      … list 単位の名寄せバッチ RPC（DEFINER・fail-soft）
--
-- ⛔ 本 migration に含めないもの（BM-2 以降の範囲）:
--   取込/rematch の配線・API・UI・desired_junior_school の名寄せ（本 PR は elementary 固定）。
--   school_districts / school_district_licenses への ALTER・UPDATE・INSERT は行わない（参照のみ）。
--
-- 前提（手順1 で実測・PM 照合済み・推測ではない）:
--   - school_districts は id/school_name/school_type/muni_code_5/is_public/source_version を持つ。
--     school_type ∈ {elementary, junior_high, compulsory}。is_public は生成列（安全装置）。
--   - ETL（scripts/etl/load_school_districts.py）は school_name = A27_004/A32_004 を strip のみで格納
--     （接頭辞「〜立」除去・接尾辞除去なし。末尾は「小学校/中学校」。「〜立」は establisher 側）。
--     → name_exact は btrim 後の生値で sd.school_name = input_name。normalize は両辺に適用する。
--   - スコープ②: customer_list_rows.desired_muni_code_5（あれば 1 件）／無ければ当該 list の
--     customer_list_row_geocodes.muni_code_5（5桁）distinct。両者とも 5 桁体系で整合。
--   - current_user_org_ids() は既存。RLS は customer_list_row_geocodes（clrg_*）と同型。
--
-- ⚠ 確定と推定を混ぜない（原則1）: match_method で経路（name_exact/name_normalized/ambiguous/
--   unmatched/out_of_coverage/no_input）を残し、断定できない一致は school_district_id を NULL にする。
-- =====================================================================

BEGIN;


-- =====================================================================
-- (5) normalize_school_name ── 校名の名寄せ用正規化（両辺に同じ関数を適用）
-- =====================================================================
-- NFKC → 空白除去 → 接頭辞「〜立」（市町村区立/組合立）除去 → 小学校系接尾辞除去。
-- 冪等（f(f(x))=f(x)）で、空文字は返さない（除去し切ったら元の空白除去済み値へフォールバック）。
-- LANGUAGE sql IMMUTABLE STRICT（NULL 入力は NULL）。式インデックス化も可能。
CREATE OR REPLACE FUNCTION public.normalize_school_name(p text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = public, pg_temp AS $$
  SELECT COALESCE(NULLIF(
           regexp_replace(
             regexp_replace(s, '^(.+?[市町村区]|.*?組合)立', ''),
             '(小学校区|小学校|学区|校区|小)$', ''),
         ''), s)
  FROM (SELECT regexp_replace(normalize(p, NFKC), '\s+', '', 'g') AS s) t
$$;

REVOKE ALL ON FUNCTION public.normalize_school_name(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.normalize_school_name(text) TO authenticated;
COMMENT ON FUNCTION public.normalize_school_name(text) IS
  '校名の名寄せ用正規化（NFKC・空白除去・「〜立」接頭辞・小学校系接尾辞を除去。冪等・空文字を返さない）。両辺に同じ関数を適用する';


-- =====================================================================
-- (4) customer_list_row_desired_districts（買い行×希望校区の名寄せ結果）
-- =====================================================================
-- 1 行 = 1 顧客行の 1 校種（本 PR は elementary 固定）の名寄せ結果。洗い替え運用のため created_at のみ。
-- list_id/user_id/organization_id は親から上書き（トリガー）。geocodes と同じ 3 列構成。
CREATE TABLE public.customer_list_row_desired_districts (
  row_id             uuid NOT NULL REFERENCES public.customer_list_rows(id) ON DELETE CASCADE,
  school_type        text NOT NULL DEFAULT 'elementary' CHECK (school_type IN ('elementary','junior_high')),
  school_district_id uuid REFERENCES public.school_districts(id) ON DELETE CASCADE,
  muni_code_5        text,           -- 探索スコープ（5桁・スコープが1件のときのみ）
  input_name         text,           -- desired_school 生値（NULL＝no_input）
  normalized_name    text,
  match_method       text NOT NULL CHECK (match_method IN
                       ('name_exact','name_normalized','ambiguous','unmatched','out_of_coverage','no_input')),
  candidate_count    integer NOT NULL DEFAULT 0,
  source_version     text,           -- 一致した校区の source_version
  list_id            uuid NOT NULL,
  user_id            uuid NOT NULL,
  organization_id    uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (row_id, school_type),
  CHECK ((school_district_id IS NOT NULL) = (match_method IN ('name_exact','name_normalized'))),
  CHECK ((match_method = 'no_input') = (input_name IS NULL))
);
CREATE INDEX ON public.customer_list_row_desired_districts (list_id, school_type, school_district_id);

COMMENT ON TABLE public.customer_list_row_desired_districts IS
  'BM-1（D-bm- 仮番）: 買い行（lead_type=buy）の希望校区（小学校）名寄せ結果。'
  'match_method で経路を、school_district_id の有無で確定/非確定を分ける（原則1）。'
  '洗い替え運用のため created_at のみ。RLS は customer_list_row_geocodes と同型。';
COMMENT ON COLUMN public.customer_list_row_desired_districts.match_method IS
  'name_exact/name_normalized=一意確定（school_district_id 非 NULL）／ambiguous=候補複数（candidate_count に件数・id は NULL）／'
  'unmatched=候補内に一致なし／out_of_coverage=スコープに公開小学校区が無い／no_input=希望校区の記載なし。';
COMMENT ON COLUMN public.customer_list_row_desired_districts.muni_code_5 IS
  '探索スコープが 1 件のときその 5 桁コード。複数市区にまたがる場合は NULL。';

-- ── 親行から所有情報を継承するトリガー（c1 の兄弟関数を流用・BEFORE INSERT OR UPDATE）──
DROP TRIGGER IF EXISTS trg_set_customer_list_row_desired_district_owner
  ON public.customer_list_row_desired_districts;
CREATE TRIGGER trg_set_customer_list_row_desired_district_owner
  BEFORE INSERT OR UPDATE ON public.customer_list_row_desired_districts
  FOR EACH ROW EXECUTE FUNCTION public.set_customer_list_row_child_owner();

-- ── RLS（customer_list_row_geocodes の clrg_* 4 本を逐語コピー・緩めない）──────
ALTER TABLE public.customer_list_row_desired_districts ENABLE ROW LEVEL SECURITY;

-- 関数呼び出しは行ごと再評価を避けるため必ず (select ...) / IN (SELECT ...) で包む。
DROP POLICY IF EXISTS "clrdd_select_org" ON public.customer_list_row_desired_districts;
CREATE POLICY "clrdd_select_org" ON public.customer_list_row_desired_districts
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.current_user_org_ids()));

DROP POLICY IF EXISTS "clrdd_insert_org" ON public.customer_list_row_desired_districts;
CREATE POLICY "clrdd_insert_org" ON public.customer_list_row_desired_districts
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (SELECT public.current_user_org_ids())
    AND user_id = (select auth.uid())
  );

DROP POLICY IF EXISTS "clrdd_update_org" ON public.customer_list_row_desired_districts;
CREATE POLICY "clrdd_update_org" ON public.customer_list_row_desired_districts
  FOR UPDATE TO authenticated
  USING (
    user_id = (select auth.uid())
    AND organization_id IN (SELECT public.current_user_org_ids())
  )
  WITH CHECK (
    user_id = (select auth.uid())
    AND organization_id IN (SELECT public.current_user_org_ids())
  );

DROP POLICY IF EXISTS "clrdd_delete_org" ON public.customer_list_row_desired_districts;
CREATE POLICY "clrdd_delete_org" ON public.customer_list_row_desired_districts
  FOR DELETE TO authenticated
  USING (
    user_id = (select auth.uid())
    AND organization_id IN (SELECT public.current_user_org_ids())
  );

-- ── テーブル権限の最小化（geocodes と同一）──────────────────────────
REVOKE ALL ON public.customer_list_row_desired_districts FROM anon, authenticated;
GRANT SELECT ON public.customer_list_row_desired_districts TO authenticated;


-- =====================================================================
-- (6) match_customer_list_desired_districts(p_list_id uuid) → jsonb
-- =====================================================================
-- list 単位の名寄せバッチ。match_customer_list_rows と同型:
--   LANGUAGE plpgsql / SECURITY DEFINER / SET search_path=public, pg_temp /
--   list 単位で delete→insert の洗い替え / 行単位 fail-soft / RETURNS jsonb /
--   EXECUTE は service_role のみ。
-- 対象は customer_list_rows.deleted_at IS NULL AND lead_type='buy' の現存買い行。
-- ⚠ DEFINER なのは、参照表 school_districts が deny-by-default（authenticated は is_public のみ）で、
--   service_role 専用の DEFINER 経由で公開校区を読んで突合するため（RLS を緩めない）。
CREATE OR REPLACE FUNCTION public.match_customer_list_desired_districts(p_list_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r            record;
  v_input      text;
  v_norm       text;
  v_scope      text[];
  v_muni5      text;
  v_candpool   integer;
  v_cand       integer;
  v_sd_id      uuid;
  v_srcver     text;
  v_method     text;
  v_total      integer := 0;
  v_matched    integer := 0;
  v_ambiguous  integer := 0;
  v_unmatched  integer := 0;
  v_ooc        integer := 0;   -- out_of_coverage
  v_noinput    integer := 0;
  v_failed     integer := 0;
BEGIN
  -- ── 洗い替え（list 単位 delete→insert）─────────────────────────────
  DELETE FROM public.customer_list_row_desired_districts WHERE list_id = p_list_id;

  -- 対象＝当該 list の現存買い行のみ（O54・裁定A と同じ現存条件）。
  FOR r IN
    SELECT id, list_id, user_id, organization_id, desired_school, desired_muni_code_5
    FROM public.customer_list_rows
    WHERE list_id = p_list_id
      AND deleted_at IS NULL
      AND lead_type = 'buy'
  LOOP
    v_total := v_total + 1;

    -- fail-soft: 1 行の失敗で list 全体を止めない（例外は failed に集計して継続）。
    BEGIN
      -- 行ごとに初期化する。
      v_input  := nullif(btrim(coalesce(r.desired_school, '')), '');
      v_norm   := NULL;
      v_scope  := NULL;
      v_muni5  := NULL;
      v_cand   := 0;
      v_sd_id  := NULL;
      v_srcver := NULL;

      IF v_input IS NULL THEN
        -- 希望校区の記載なし。
        v_method := 'no_input';
        v_noinput := v_noinput + 1;
      ELSE
        -- 両辺に同じ正規化を適用（no_input 以外）。
        v_norm := public.normalize_school_name(v_input);

        -- ── スコープ導出 ─────────────────────────────────────────────
        IF nullif(btrim(coalesce(r.desired_muni_code_5, '')), '') IS NOT NULL THEN
          v_scope := ARRAY[ btrim(r.desired_muni_code_5) ];
        ELSE
          SELECT array_agg(DISTINCT g.muni_code_5)
            INTO v_scope
          FROM public.customer_list_row_geocodes g
          WHERE g.list_id = p_list_id
            AND g.muni_code_5 IS NOT NULL;
        END IF;

        -- muni_code_5 列: スコープが 1 件のときその値、複数/空は NULL。
        IF v_scope IS NOT NULL AND array_length(v_scope, 1) = 1 THEN
          v_muni5 := v_scope[1];
        END IF;

        -- ── 候補母数（is_public AND elementary AND スコープ内）─────────────
        IF v_scope IS NULL OR array_length(v_scope, 1) IS NULL THEN
          v_candpool := 0;
        ELSE
          SELECT count(*)::int
            INTO v_candpool
          FROM public.school_districts sd
          WHERE sd.is_public IS TRUE
            AND sd.school_type = 'elementary'
            AND sd.muni_code_5 = ANY(v_scope);
        END IF;

        IF v_candpool = 0 THEN
          -- スコープ内に公開の小学校区が無い（未整備/非公開自治体）。
          v_method := 'out_of_coverage';
          v_ooc := v_ooc + 1;
        ELSE
          -- ── A. 生値完全一致 ─────────────────────────────────────────
          SELECT count(*)::int,
                 (array_agg(sd.id             ORDER BY sd.source_version DESC))[1],
                 (array_agg(sd.source_version ORDER BY sd.source_version DESC))[1]
            INTO v_cand, v_sd_id, v_srcver
          FROM public.school_districts sd
          WHERE sd.is_public IS TRUE
            AND sd.school_type = 'elementary'
            AND sd.muni_code_5 = ANY(v_scope)
            AND sd.school_name = v_input;

          IF v_cand = 1 THEN
            v_method := 'name_exact';
            v_matched := v_matched + 1;
          ELSIF v_cand >= 2 THEN
            v_method := 'ambiguous';
            v_sd_id := NULL; v_srcver := NULL;
            v_ambiguous := v_ambiguous + 1;
          ELSE
            -- ── B. 正規化一致（生値一致 0 件のときのみ）─────────────────────
            SELECT count(*)::int,
                   (array_agg(sd.id             ORDER BY sd.source_version DESC))[1],
                   (array_agg(sd.source_version ORDER BY sd.source_version DESC))[1]
              INTO v_cand, v_sd_id, v_srcver
            FROM public.school_districts sd
            WHERE sd.is_public IS TRUE
              AND sd.school_type = 'elementary'
              AND sd.muni_code_5 = ANY(v_scope)
              AND public.normalize_school_name(sd.school_name) = v_norm;

            IF v_cand = 1 THEN
              v_method := 'name_normalized';
              v_matched := v_matched + 1;
            ELSIF v_cand >= 2 THEN
              v_method := 'ambiguous';
              v_sd_id := NULL; v_srcver := NULL;
              v_ambiguous := v_ambiguous + 1;
            ELSE
              v_method := 'unmatched';
              v_sd_id := NULL; v_srcver := NULL;
              v_unmatched := v_unmatched + 1;
            END IF;
          END IF;
        END IF;
      END IF;

      -- ── INSERT（school_type='elementary' 固定・トリガーが所有 3 列を上書きするが
      --    NOT NULL を満たすため親行の値を明示する。geocodes/match_customer_list_rows の作法）──
      INSERT INTO public.customer_list_row_desired_districts (
        row_id, school_type,
        school_district_id, muni_code_5,
        input_name, normalized_name,
        match_method, candidate_count, source_version,
        list_id, user_id, organization_id
      ) VALUES (
        r.id, 'elementary',
        v_sd_id, v_muni5,
        v_input, v_norm,
        v_method, coalesce(v_cand, 0), v_srcver,
        r.list_id, r.user_id, r.organization_id
      );

    EXCEPTION WHEN OTHERS THEN
      -- fail-soft: この行だけ諦めて次へ。SQLSTATE はサーバーログに残る。
      v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'total',           v_total,
    'matched',         v_matched,
    'ambiguous',       v_ambiguous,
    'unmatched',       v_unmatched,
    'out_of_coverage', v_ooc,
    'no_input',        v_noinput,
    'failed',          v_failed
  );
END;
$$;

COMMENT ON FUNCTION public.match_customer_list_desired_districts(uuid) IS
  'BM-1（D-bm- 仮番）: 1 list 分の買い行（lead_type=buy・deleted_at IS NULL）の希望校区（小学校）を'
  'customer_list_row_desired_districts へ洗い替え保存する名寄せバッチ。'
  '両辺に normalize_school_name を適用し name_exact→name_normalized の順に一意一致を探す。'
  '候補複数=ambiguous / スコープに公開小学校区なし=out_of_coverage / 記載なし=no_input（原則1）。'
  'SECURITY DEFINER で school_districts の deny-by-default を越えて公開校区を読む。EXECUTE は service_role のみ。'
  'fail-soft（行単位で失敗を集計し list 全体は止めない）。呼び出し元＝取込ルート/rematch（配線は BM-2）。';

-- ── 実行権限（service_role のみ）──────────────────────────────────
REVOKE ALL ON FUNCTION public.match_customer_list_desired_districts(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_customer_list_desired_districts(uuid)
  TO service_role;

COMMIT;


-- =====================================================================
-- ロールバック SQL（適用を取り消す場合・PM が手動実行）:
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.match_customer_list_desired_districts(uuid);
--   DROP TABLE IF EXISTS public.customer_list_row_desired_districts;   -- ⚠ 名寄せ結果も消える
--   DROP FUNCTION IF EXISTS public.normalize_school_name(text);
--   COMMIT;
--   -- ⛔ set_customer_list_row_child_owner() は 20260908000100 の資産。ここでは DROP しない。
--   -- ⛔ school_districts / school_district_licenses は参照のみ。触らない。
-- =====================================================================


-- =====================================================================
-- 検証クエリ（適用後に手動実行・詳細は scripts/sql/verify_bm1_schema.sql）
-- =====================================================================
--
-- ── ① normalize_school_name の冪等・接頭辞/接尾辞（両辺同一規則）──────────
--   SELECT input, expected, public.normalize_school_name(input) AS actual,
--          public.normalize_school_name(input) = expected AS ok,
--          public.normalize_school_name(public.normalize_school_name(input))
--            = public.normalize_school_name(input) AS idempotent
--   FROM (VALUES
--     ('岡崎市立六名小学校','六名'), ('六名小','六名'), ('六名小学校区','六名'),
--     ('　六名　小学校　','六名'), ('立花小学校','立花'), ('岡崎市立立花小学校','立花'),
--     ('花立小学校','花立'), ('野市小学校','野市'), ('ﾛｸﾒｲ小','ロクメイ'),
--     ('六ッ美中部小学校','六ッ美中部'), ('六ッ美中部小','六ッ美中部'),
--     ('岡崎市立六ッ美中部小学校','六ッ美中部')
--   ) AS t(input, expected);
--   -- 期待: ok=t / idempotent=t（全行）。空文字は返さない。
--
-- ── ② 関数属性 ──────────────────────────────────────────────
--   SELECT p.proname, p.prosecdef, p.provolatile, array_to_string(p.proconfig, ',') AS cfg,
--          pg_get_function_result(p.oid) AS result
--   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--   WHERE n.nspname='public'
--     AND p.proname IN ('normalize_school_name','match_customer_list_desired_districts');
--   -- 期待: normalize=prosecdef f / provolatile i / search_path あり。
--   --       match=prosecdef t / provolatile v / search_path あり。
--
-- ── ③ 権限（aclexplode）─────────────────────────────────────────
--   -- normalize=authenticated のみ / match=service_role のみ（下記 verify_bm1_schema.sql 参照）。
-- =====================================================================

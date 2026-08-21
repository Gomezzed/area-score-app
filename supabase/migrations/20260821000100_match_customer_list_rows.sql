-- =====================================================================
-- 20260821000100_match_customer_list_rows.sql
-- PR-D改 c2 / M2-5b PR#4: リスト単位の突合バッチ RPC（結線の DB 側）。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う（R7・D57）。
--   ※ supabase db push は恒久禁止。
--
-- 本 migration が作るもの:
--   public.match_customer_list_rows(p_list_id uuid, p_rows jsonb) → jsonb（集計サマリ）
--     1 リスト分の行を一括で
--       ① 住所→代表点   … 既存 public.match_address_to_geo_point()
--       ② 代表点→校区   … 既存 public.match_point_to_school_districts()
--     に通し、結果を customer_list_row_geocodes / customer_list_row_school_districts へ書く。
--   ⛔ 既存 2 関数は **再実装せず呼ぶだけ**（PR#2/#3・本番適用済み）。
--
-- 入力 p_rows（TS 側 normalizeJpAddress の分解結果を JSON 配列で渡す）:
--   [ { "row_id": uuid, "muni_code_5": text|null, "town": text|null,
--       "chome": text|null, "ban": text|null, "go": text|null }, ... ]
--   ⚠ 住所全体を (muni_code_5, town, chome, ban, go) に分解する処理は SQL 側に無い
--     （TS の src/lib/address/normalize-jp.ts が唯一の分解器）。よって分解済みの値を
--     受け取る契約にする。突合キーの文字レベル正規化は既存 2 関数の内部で行われる。
--
-- 設計要件（裁定B）:
--   - SECURITY DEFINER + SET search_path を明示（裁定B）。
--       ⚠ 既存 2 関数は SECURITY INVOKER かつ参照表（geo_reference_points /
--         school_districts）は deny-by-default。本関数を DEFINER（所有者＝適用者）に
--         することで、内側の INVOKER 関数が所有者権限で参照表を読めるようになり突合が成立する。
--         RLS を緩めるのではなく、service_role 専用の DEFINER 経由でのみ到達させる。
--       ※ search_path は `public, pg_temp` とする（c7）。参照は全て public. 明示修飾だが、
--         既存 DEFINER 関数（set_customer_list_row_org 等）の防御水準に揃え、末尾に pg_temp を
--         明示して search_path 注入を防ぐ。PostGIS 呼び出しは内側の INVOKER 関数（自前 search_path）
--         と生成列（OID 固定）に閉じているため解決に問題はない。
--   - REVOKE EXECUTE を PUBLIC / anon / authenticated から行い、GRANT は service_role のみ。
--   - fail-soft: 行単位で例外を捕捉し、失敗は failed に集計してリスト全体は止めない。
--   - 洗い替え: 同一 list_id の既存突合行を先に DELETE してから INSERT（delete→insert）。
--       c4 rematch も本関数を再利用するため、毎回全件洗い替えを冪等に行う。
--   - 対象は customer_list_rows.deleted_at IS NULL の現存行のみ（O54・裁定A）。
--
-- 返り値（jsonb 集計サマリ）:
--   { "total": 受領した行数, "processed": 実際に突合した現存行数,
--     "geocoded": 代表点が確定/推定で付いた行数（match_confidence <> 'unknown'）,
--     "school_rows": school_districts へ書いた行数, "failed": 行単位で失敗した行数,
--     "skipped": 対象外（削除済み/別リスト/不明 row_id）でスキップした行数 }
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.match_customer_list_rows(
  p_list_id uuid,
  p_rows    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- 全参照は public. で修飾済みだが、既存 DEFINER 関数（set_customer_list_row_org /
--   set_customer_list_row_geocode_owner / set_sale_prediction_log_org）の防御水準に揃え、
--   末尾に pg_temp を明示して search_path 注入を防ぐ（DEFINER 実行時の一時オブジェクト経路の固定）。
SET search_path = public, pg_temp
AS $$
DECLARE
  v_elem       jsonb;
  v_row_id     uuid;
  v_muni5      text;
  v_town       text;
  v_chome      text;
  v_ban        text;
  v_go         text;
  v_geo        record;
  v_sd         record;
  v_exists     boolean;
  v_total      integer := 0;
  v_processed  integer := 0;
  v_geocoded   integer := 0;
  v_school     integer := 0;
  v_failed     integer := 0;
  v_skipped    integer := 0;
BEGIN
  -- ── 洗い替え（delete→insert・裁定B）─────────────────────────────
  -- 子（school_districts）→ 親（geocodes）の順に消す。どちらも list_id 非正規化列を持つ。
  DELETE FROM public.customer_list_row_school_districts WHERE list_id = p_list_id;
  DELETE FROM public.customer_list_row_geocodes         WHERE list_id = p_list_id;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object(
      'total', 0, 'processed', 0, 'geocoded', 0,
      'school_rows', 0, 'failed', 0, 'skipped', 0);
  END IF;

  FOR v_elem IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_total := v_total + 1;

    -- fail-soft: 1 行の失敗でリスト全体を止めない（例外は failed に集計して継続）。
    BEGIN
      v_row_id := nullif(v_elem->>'row_id', '')::uuid;
      IF v_row_id IS NULL THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      -- 防御: row_id が当該リストの現存（未削除）行であることを確認（O54・裁定A）。
      --   削除済み・別リスト・不明 id はスキップ（親子 org 一致は挿入時トリガーも担保する）。
      SELECT true INTO v_exists
      FROM public.customer_list_rows r
      WHERE r.id = v_row_id
        AND r.list_id = p_list_id
        AND r.deleted_at IS NULL;
      IF NOT FOUND THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      v_muni5 := nullif(v_elem->>'muni_code_5', '');
      v_town  := nullif(v_elem->>'town', '');
      v_chome := nullif(v_elem->>'chome', '');
      v_ban   := nullif(v_elem->>'ban', '');
      v_go    := nullif(v_elem->>'go', '');

      -- ── ① 住所→代表点（常に 1 行返る）─────────────────────────────
      SELECT * INTO v_geo
      FROM public.match_address_to_geo_point(
        v_muni5, coalesce(v_town, ''), v_chome, v_ban, v_go);

      -- list_id / user_id / organization_id は BEFORE INSERT トリガー
      --   （set_customer_list_row_geocode_owner）が親行から必ず上書きするため列挙しない。
      INSERT INTO public.customer_list_row_geocodes (
        row_id,
        muni_code_5, matched_town, matched_subarea, matched_chome, matched_block,
        geo_point_id, geo_source_version, lat, lon,
        match_method, match_confidence, match_reason, candidate_count
      ) VALUES (
        v_row_id,
        v_muni5, v_geo.matched_town, v_geo.matched_subarea, v_geo.matched_chome, v_geo.matched_block,
        v_geo.geo_point_id, v_geo.source_version, v_geo.lat, v_geo.lon,
        v_geo.match_method, v_geo.match_confidence, v_geo.match_reason,
        coalesce(v_geo.candidate_count, 0)
      );

      IF v_geo.match_confidence <> 'unknown' THEN
        v_geocoded := v_geocoded + 1;
      END IF;

      -- ── ② 代表点→校区（常に 2 行: elementary / junior_high）──────────
      --   代表点が無い（unmatched）ときは lat/lon が NULL で、関数は not_geocoded を返す。
      --   代表点の確からしさ（match_confidence）を point_confidence として渡し、
      --   推定代表点なら学区側も confirmed に昇格させない（推定の連鎖を隠さない）。
      FOR v_sd IN
        SELECT * FROM public.match_point_to_school_districts(
          v_geo.lat, v_geo.lon, v_muni5, v_geo.match_confidence)
      LOOP
        INSERT INTO public.customer_list_row_school_districts (
          row_id, school_type,
          school_district_id, source_version,
          match_method, match_confidence, match_reason,
          border_distance_m, near_border, candidate_count, point_confidence
        ) VALUES (
          v_row_id, v_sd.school_type,
          v_sd.school_district_id, v_sd.source_version,
          v_sd.match_method, v_sd.match_confidence, v_sd.match_reason,
          v_sd.border_distance_m, v_sd.near_border,
          coalesce(v_sd.candidate_count, 0), v_geo.match_confidence
        );
        v_school := v_school + 1;
      END LOOP;

      v_processed := v_processed + 1;

    EXCEPTION WHEN OTHERS THEN
      -- fail-soft: この行だけ諦めて次へ。SQLSTATE はサーバーログに残る。
      v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'total', v_total,
    'processed', v_processed,
    'geocoded', v_geocoded,
    'school_rows', v_school,
    'failed', v_failed,
    'skipped', v_skipped
  );
END;
$$;

COMMENT ON FUNCTION public.match_customer_list_rows(uuid, jsonb) IS
  'M2-5b PR#4 / PR-D改 c2: 1 リスト分の行を一括で住所→代表点→校区に突合し、'
  'customer_list_row_geocodes / customer_list_row_school_districts へ洗い替え保存する。'
  '既存 match_address_to_geo_point / match_point_to_school_districts を呼ぶだけ（再実装しない）。'
  'SECURITY DEFINER で参照表の deny-by-default を越えて突合する。EXECUTE は service_role のみ。'
  'fail-soft（行単位で失敗を集計しリスト全体は止めない）。対象は deleted_at IS NULL の現存行のみ。';

-- ── 実行権限（service_role のみ・裁定B）──────────────────────────────
-- 新規 public 関数は既定で PUBLIC に EXECUTE が付くため明示的に剥がす。
-- authenticated にも付けない（突合は取り込み時のサーバー側処理＝service_role で回す）。
REVOKE ALL ON FUNCTION public.match_customer_list_rows(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_customer_list_rows(uuid, jsonb)
  TO service_role;

COMMIT;


-- =====================================================================
-- ロールバック SQL（適用を取り消す場合・PM が手動実行）:
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.match_customer_list_rows(uuid, jsonb);
--   COMMIT;
--   -- ⛔ match_address_to_geo_point / match_point_to_school_districts は PR#2/#3 の資産。
--   --    DROP しないこと（本関数はそれらを呼ぶだけ）。
-- =====================================================================


-- =====================================================================
-- 検証クエリ（適用後に手動実行）
-- =====================================================================
--
-- ── ① 権限（service_role のみ EXECUTE・裁定B）─────────────────────────
--   SELECT p.proname, array_to_string(p.proacl::text[], ' | ') AS acl,
--          p.prosecdef AS security_definer,
--          array_to_string(p.proconfig, ',') AS config
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='public' AND p.proname='match_customer_list_rows';
--   -- 期待: security_definer=t / config に 'search_path=public, pg_temp' /
--   --       acl に anon= も authenticated= も含まれない（service_role=X のみ）。
--   SET ROLE anon;
--   SELECT public.match_customer_list_rows('00000000-0000-0000-0000-000000000000', '[]'::jsonb);
--   -- 期待: ERROR permission denied for function match_customer_list_rows
--   RESET ROLE;
--
-- ── ② 8市サンプルで代表点＋校区が書けること（service_role で実行）──────────
--   -- 事前に対象 list の customer_list_rows を 1 行用意し、その row_id と分解済み住所で:
--   --   SELECT public.match_customer_list_rows(:list_id, jsonb_build_array(
--   --     jsonb_build_object('row_id', :row_id, 'muni_code_5','23201',
--   --                        'town','平川本町','chome','1','ban','16','go',NULL)));
--   -- 期待: {"total":1,"processed":1,"geocoded":1,"school_rows":2,"failed":0,"skipped":0}
--   --   customer_list_row_geocodes に 1 行（block_exact/confirmed）、
--   --   customer_list_row_school_districts に 2 行（contains/confirmed）。
--
-- ── ③ 洗い替え（冪等）── 同じ list で 2 回呼んで行数が増えないこと。
--
-- ── ④ 削除済み行のスキップ ── deleted_at を立てた row_id を渡すと skipped に数えられ、
--   geocodes/school_districts に行が入らないこと。
--
-- ── ⑤ fail-soft ── 実在しない row_id を混ぜても total に数え skipped/failed で継続し、
--   他の正常行は処理されること（例外でリスト全体が失敗しない）。
-- =====================================================================

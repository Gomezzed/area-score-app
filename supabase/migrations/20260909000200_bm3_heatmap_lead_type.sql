-- =====================================================================
-- 20260909000200_bm3_heatmap_lead_type.sql
-- PR-BM-3 / Tier1: get_school_district_heatmap の p_mode に lead_type を反映する。
--   決定: 2026-09-09 PM 裁定9〜10（本セッション）。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う（R7・D57）。
--   ※ supabase db push は恒久禁止。
--
-- 【背景・現状の問題】(PM が本番で実測・手順1)
--   現行 20260825000200 の p_mode 分岐は AND p_mode = 'sell' の1行のみで、
--   customer_list_rows.lead_type を一切見ていない。'sell'(既定値・唯一呼び出し
--   実績のある値) は買い行(lead_type='buy')を除外せず、買い反響も売り反響も
--   同じ母数で数えてしまう。'buy' を渡すと counts が常に空になる(未実装)。
--
-- 本 PR の変更範囲（これ以外は現行から変えない）:
--   (1) p_mode='sell' → 対象行を lead_type IN ('sell','unknown') に限定（裁定9）。
--   (2) p_mode='buy'  → customer_list_row_desired_districts（名寄せ結果・BM-1/c2）
--       を school_district_id で school_districts に JOIN し、sell 側と同じ6列を
--       返す。match_method IN ('name_exact','name_normalized') のみ対象、
--       lead_type='buy' の厳格一致（裁定10）。
--   (3) k=5 抑止・NO_DATA の扱い・返り値の列構成・シグネチャは一切変えない。
--       sell/buy を UNION ALL で1本の counts に合流させてから共通の
--       GROUP BY/HAVING/tier 計算を通すことで、k=5 とtierロジックを分岐で
--       別実装にしない（裁定10）。
--
-- ⛔ 変えないもの:
--   - 引数名・型・順序・既定値／返り値の列構成（RETURNS TABLE は現行のまま）。
--   - 権限（DEFINER/REVOKE/GRANT）。呼び出し側（API/UI/PDF）は無変更（裁定11）。
--   - SECURITY INVOKER / LANGUAGE sql / STABLE / search_path = public, pg_temp。
--   - allowlist: p_school_type は 'elementary' / 'junior_high' のみ。
--   - 多層防御: current_user_plan()='platinum' / organization_id ∈
--     current_user_org_ids() / is_public を関数側でも明示。
--   - tier = ceil(cume_dist() over (PARTITION BY muni_code_5 ORDER BY n) * 4)。
--   - deleted_at IS NULL の除外は sell/buy 双方で同一の書き方（裁定10）。
--     missing_since は現状どおり見ない。
--
-- 【裁定9の理由・sell側】'unknown' は区分未判定の既存行（BM-2 以前の取込は全行
--   lead_type='unknown'）。BM-2 以降の取込で区分が付く。lead_type='sell' 厳格に
--   すると既存名簿のヒートマップが空になるため、区分が判明している買い行
--   (lead_type='buy') だけを除外する。
--
-- 【裁定10・buy側の対象行条件について】match_status(住所→町域突合)・inquiry_at
--   (反響日時)の絞り込みは buy 側に追加しない。根拠: 同じ買い行を対象にする
--   既存の public.match_customer_list_desired_districts（20260908000200）が
--   「現存条件」として WHERE list_id=... AND deleted_at IS NULL AND lead_type='buy'
--   のみを使っており(O54・裁定Aと同じ)、match_status/inquiry_at は見ていない。
--   本 PR はこの既存の「現存条件」定義に揃える（推測ではなく実装済みの前例に一致）。
--
-- 前提（20260825000200 と同一・PM 実測）:
--   - SECURITY INVOKER / LANGUAGE sql / STABLE / search_path = public, pg_temp
--   - 組織スコープの正 = public.current_user_org_ids()
--   - プラン判定の正   = public.current_user_plan()
-- =====================================================================

BEGIN;

-- 引数構成は現行 (uuid, text, text, text) のまま変わらないため CREATE OR REPLACE で足りる
-- （DROP は不要。20260825000200 の「引数が増える場合は DROP」というただし書きはここでは非該当）。
CREATE OR REPLACE FUNCTION public.get_school_district_heatmap(
  p_list_id uuid,
  p_school_type text DEFAULT 'elementary',
  p_mode text DEFAULT 'sell',
  p_muni_code_5 text DEFAULT NULL
)
RETURNS TABLE (
  school_district_id uuid,
  school_name        text,
  muni_code_5        text,
  muni_name          text,
  tier               smallint,
  attribution_text   text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  -- matched: sell/buy それぞれの対象行を同じ列構成に揃えて UNION ALL する。
  --   p_mode で片方だけが行を返す(他方は WHERE 冒頭の p_mode 比較で空)ため、
  --   以降の GROUP BY/HAVING/tier 計算は mode 分岐なしの共通ロジックになる。
  WITH matched AS (
    -- sell: 確定した反響の校区一致（customer_list_row_school_districts）。
    SELECT
      d.id               AS school_district_id,
      d.school_name      AS school_name,
      d.muni_code_5      AS muni_code_5,
      d.muni_name        AS muni_name,
      d.attribution_text AS attribution_text
    FROM public.customer_list_rows r
    JOIN public.customer_list_row_school_districts l
      ON l.row_id = r.id
    JOIN public.school_districts d
      ON d.id = l.school_district_id
    WHERE p_mode = 'sell'
      AND r.list_id = p_list_id
      AND r.deleted_at IS NULL
      AND r.match_status = 'confirmed'
      AND r.inquiry_at IS NOT NULL
      AND r.inquiry_at >= now() - interval '12 months'
      AND l.school_type = p_school_type
      AND l.school_district_id IS NOT NULL
      AND d.is_public IS TRUE
      AND (p_muni_code_5 IS NULL OR d.muni_code_5 = p_muni_code_5)
      AND p_school_type IN ('elementary', 'junior_high')
      -- 裁定9: 'unknown' は区分未判定の既存行(BM-2以前の取込は全行unknown)。
      --   BM-2以降の取込で区分が付く。買い行(lead_type='buy')だけを除外する。
      AND r.lead_type IN ('sell', 'unknown')
      AND public.current_user_plan() = 'platinum'
      AND r.organization_id IN (SELECT public.current_user_org_ids())

    UNION ALL

    -- buy: 希望校区の名寄せ結果（customer_list_row_desired_districts）。
    --   確定した一致(name_exact/name_normalized)のみ対象。裁定10。
    SELECT
      d.id               AS school_district_id,
      d.school_name      AS school_name,
      d.muni_code_5      AS muni_code_5,
      d.muni_name        AS muni_name,
      d.attribution_text AS attribution_text
    FROM public.customer_list_rows r
    JOIN public.customer_list_row_desired_districts l
      ON l.row_id = r.id
    JOIN public.school_districts d
      ON d.id = l.school_district_id
    WHERE p_mode = 'buy'
      AND r.list_id = p_list_id
      AND r.deleted_at IS NULL
      AND l.school_type = p_school_type
      AND l.match_method IN ('name_exact', 'name_normalized')
      AND d.is_public IS TRUE
      AND (p_muni_code_5 IS NULL OR d.muni_code_5 = p_muni_code_5)
      AND p_school_type IN ('elementary', 'junior_high')
      AND r.lead_type = 'buy'
      AND public.current_user_plan() = 'platinum'
      AND r.organization_id IN (SELECT public.current_user_org_ids())
  ),
  -- counts: mode を問わず同じ集計・k=5 抑止ロジック（裁定10: 分岐で別実装にしない）。
  counts AS (
    SELECT
      school_district_id,
      school_name,
      muni_code_5,
      muni_name,
      attribution_text,
      count(*) AS n
    FROM matched
    GROUP BY school_district_id, school_name, muni_code_5, muni_name, attribution_text
    HAVING count(*) >= 5
  )
  -- 自治体ごとの分位で tier 化 / muni_name でまとめ、その中で濃い順（現行と同一）。
  SELECT
    c.school_district_id,
    c.school_name,
    c.muni_code_5,
    c.muni_name,
    ceil(cume_dist() OVER (PARTITION BY c.muni_code_5 ORDER BY c.n) * 4)::smallint AS tier,
    c.attribution_text
  FROM counts c
  ORDER BY c.muni_name, tier DESC, c.school_name;
$$;

COMMENT ON FUNCTION public.get_school_district_heatmap(uuid, text, text, text) IS
  'PR-BM-3: 顧客リストの反響を校区ごとに集計し4段階(tier)の濃淡を返す。tier は自治体(muni_code_5)ごとの分位=ceil(cume_dist() over (PARTITION BY muni_code_5 ORDER BY n)*4)(ntile 不使用＝同数同色)。SECURITY INVOKER で RLS(org スコープ/is_public)が効くうえ、service_role の RLS バイパスに備え current_user_plan()=platinum(SD-40)・organization_id∈current_user_org_ids()・is_public を関数側でも明示。allowlist=elementary/junior_high(それ以外は空)。k=5 抑止(HAVING count>=5)・生件数は返さない。引数: p_mode=''sell''は customer_list_row_school_districts の確定反響を lead_type IN (''sell'',''unknown'') に限定して集計、''buy''は customer_list_row_desired_districts の希望校区名寄せ結果(match_method IN name_exact/name_normalized)を lead_type=''buy'' に限定して集計。p_muni_code_5=NULL なら全自治体、指定時はその 5 桁市区町村コードのみに絞る。';

-- deny-by-default: PUBLIC/anon から実行権を剥奪し、authenticated のみに付与。
-- (新規 public RPC は anon にも自動で EXECUTE が付くため anon を明示的に REVOKE する)
REVOKE ALL ON FUNCTION public.get_school_district_heatmap(uuid, text, text, text) FROM PUBLIC, anon;
-- ★O109: Supabase の ALTER DEFAULT PRIVILEGES が新規 public 関数へ service_role の
--   EXECUTE を自動付与するため、明示的に剥がす(PUBLIC/anon の REVOKE では剥がれない・#74 と同理由)。
--   CREATE OR REPLACE は権限を保持するはずだが、20260826000200 の前例に倣い明示的に再掲する。
REVOKE ALL ON FUNCTION public.get_school_district_heatmap(uuid, text, text, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_school_district_heatmap(uuid, text, text, text) TO authenticated;

COMMIT;

-- =====================================================================
-- ROLLBACK:
--   直前定義(20260825000200)の CREATE OR REPLACE を再適用する
--   （p_mode='buy'が常に空、p_mode='sell'がlead_typeを見ない版へ戻す）。
--
-- 検証（適用後・PM 用）: scripts/sql/verify_school_district_heatmap.sql を参照・更新。
--   ・prosecdef=false(INVOKER) / proconfig に search_path=public,pg_temp
--   ・args が (uuid, text, text, text) であること（シグネチャ不変の確認）
--   ・proacl に service_role が含まれないこと（O109 の再発検知）
--   ・返り値の列に生件数(count/n)が無いこと（列構成不変の確認）
--   ・p_mode='sell'  : lead_type='buy' の行が対象から除外されていること
--   ・p_mode='buy'   : customer_list_row_desired_districts に基づいて集計され、
--                      match_method='ambiguous'/'unmatched'/'out_of_coverage'/'no_input'
--                      の行が数えられていないこと
-- =====================================================================

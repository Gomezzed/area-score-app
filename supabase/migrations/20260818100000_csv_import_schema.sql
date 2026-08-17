-- =====================================================================
-- 20260818100000_csv_import_schema.sql
-- CSV取込 PR-A / D83「受け皿完成」: ヘッダ非依存のスキーマだけを作る。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う（R7・D57）。
--   ※ supabase db push は恒久禁止。
--
-- 本 migration が作るもの:
--   (1) public.customer_list_rows への列追加（external_id / missing_since /
--       desired_school / desired_muni_code_5 / updated_at）＋ 部分UNIQUE ＋ 索引 ＋
--       updated_at 自動更新トリガー
--   (2) public.sale_prediction_log（CL-23・売却発生スコアの検証台帳）
--   (3) public.purge_missing_customer_list_rows(int)（CL-14/CL-18・30日経過分の削除）
--
-- ⛔ 本 migration に含めないもの（PR-B / PR-C の範囲）:
--   パーサ・プリセット定義（どの CSV 列を external_id / desired_school に入れるか）・
--   API 実装・UPSERT の実行ロジック・スケジューラ登録。
--
-- 前提（2026-08-18 に本番 DB で実測確認済み・推測ではない）:
--   - 台帳 65 件目（20260818000000 / m2_5b_school_district_match）まで適用済み。
--   - public.customer_list_rows は 18 列 / 48 行。CHECK は match_status の 1 本のみ
--     （'confirmed','ambiguous','out_of_scope'）。
--   - 同テーブルのトリガーは trg_set_customer_list_row_org（**BEFORE INSERT のみ**・
--     organization_id が NULL のときだけ親 customer_lists から補完）の 1 本だけ。
--   - 索引は pkey(id) / list_idx(list_id,row_no)（**UNIQUE ではない**）/ user_idx(user_id) /
--     match_idx(municipality_id,town_name_normalized) / org_idx(organization_id)。
--   - RLS は 4 本とも org 方針（CL-31）: SELECT=同一 org 共有 /
--     INSERT・UPDATE・DELETE=作成者本人 AND org 一致。
--   - 追加する 5 列はいずれも **未存在**（重複追加ではない）。
--   - customer_list_rows は 48 行しかないため、本 migration の ALTER / CREATE INDEX の
--     所要時間は無視できる。なお ADD COLUMN（NULL 許容・DEFAULT なし）は PG11 以降
--     テーブル書き換えを伴わない。
--   - 拡張の実測: 有効なのは plpgsql / pg_stat_statements / uuid-ossp / pgcrypto /
--     supabase_vault / pg_trgm / postgis のみ。**pg_cron・pg_net・pgmq は未インストール**。
--
-- ⚠ 命名（CL-09）:
--   UPSERT キーは Vault CL-09 のとおり **(list_id, external_id)**。実装側で別名を
--   使うと Vault と DB が食い違うため、呼称は変えない。
--
-- ⚠ external_id に「合成キー」を入れないこと（原則1・原則5）:
--   external_id には **CSV 側に実在する顧客番号だけ**を入れる。氏名＋住所から合成した
--   ハッシュ等（＝推定の同一性）は入れない。実在するID（確定）と合成キー（推定）を
--   同じ列に混ぜると、同姓同名・転居で静かに壊れるものを「外部IDである」と主張する
--   ことになる。顧客番号が無い CSV では **NULL のまま**にし、部分UNIQUE により
--   「同一性を追跡できない行」は UPSERT の対象外になる、という状態を構造で表現する。
--   → 帰結: 顧客番号列を持たない名簿は missing_since を付けられない。その場合の
--     取込方式（全置換にするか、追跡なしと明示するか）は PR-B の設計判断。
--
-- ⚠ SECURITY DEFINER を使う箇所と使わない箇所（意図的な使い分け）:
--   - 呼び出し可能な関数 purge_missing_customer_list_rows は **SECURITY INVOKER**
--     ＋ SET search_path = public, extensions, pg_temp（指示どおり）。
--   - 親行を読む BEFORE トリガー set_sale_prediction_log_org のみ SECURITY DEFINER。
--     既存の set_customer_list_row_org / set_customer_list_row_geocode_owner と同じ理由
--     （書き手の RLS 可視範囲に関係なく親を読めないと、親子の org 一致を保証できない）。
--     既存 2 本と同じく search_path = public, pg_temp に固定する。
--   - touch_updated_at は NEW しか触らない（テーブルを読まない）ため INVOKER で足りる。
-- =====================================================================

BEGIN;


-- =====================================================================
-- (1) customer_list_rows への列追加
-- =====================================================================
-- いずれも NULL 許容。既存 48 行は追加後すべて NULL（updated_at のみ now()）。
-- 既存の CHECK（match_status）・FK 5 本・RLS 4 本は列非依存のため影響を受けない。
ALTER TABLE public.customer_list_rows
  ADD COLUMN IF NOT EXISTS external_id         TEXT,
  ADD COLUMN IF NOT EXISTS missing_since       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS desired_school      TEXT,
  ADD COLUMN IF NOT EXISTS desired_muni_code_5 TEXT,
  ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ NOT NULL DEFAULT now();

COMMENT ON COLUMN public.customer_list_rows.external_id IS
  'CL-09: UPSERT キー (list_id, external_id) の外部ID。**CSV 側に実在する顧客番号だけ**を入れる。'
  '合成キー（氏名＋住所ハッシュ等）は入れない（確定と推定を混ぜない・原則1）。'
  '顧客番号を持たない CSV では NULL のままにし、その行は UPSERT の対象にしない。';
COMMENT ON COLUMN public.customer_list_rows.missing_since IS
  'CL-18: 前回の取込に在って今回の取込に無かった行に付ける時刻。NULL=現存。'
  'CL-14 により 30 日経過後に purge_missing_customer_list_rows で物理削除する。'
  '再び CSV に現れたら PR-B の UPSERT が NULL に戻す。';
COMMENT ON COLUMN public.customer_list_rows.desired_school IS
  'SD-25: 買い側の希望校区の**名称**（例: 六ッ美中部小学校）。ジオコーダ非依存の名称突合に使う。'
  '入力値をそのまま保持し、school_districts への解決は読み取り側/PR-B の責務（ここでは FK にしない）。';
COMMENT ON COLUMN public.customer_list_rows.desired_muni_code_5 IS
  '希望市区の 5 桁コード（あれば）。書式バリデーションはパーサ側（PR-B）の責務とし、'
  'customer_list_row_geocodes.muni_code_5 と規約を非対称にしないため CHECK は付けない。';
COMMENT ON COLUMN public.customer_list_rows.updated_at IS
  'CL-17: 最終更新時刻。BEFORE UPDATE トリガーが必ず now() に更新する。'
  '「毎回全件」方式の取込で、今回の実行で触られた行と触られなかった行を区別するために使う。';

-- ── UPSERT キー（CL-09）──────────────────────────────────────────
-- 部分 UNIQUE。external_id が NULL の行同士は衝突しない＝追跡不能な行は UPSERT 対象外。
-- ⚠ PR-B への申し送り: 部分索引を ON CONFLICT の対象にするには、推論条件を明示して
--    `ON CONFLICT (list_id, external_id) WHERE external_id IS NOT NULL DO UPDATE ...`
--    と書く必要がある（WHERE を省くと索引が推論されずエラーになる）。
CREATE UNIQUE INDEX IF NOT EXISTS customer_list_rows_external_id_key
  ON public.customer_list_rows (list_id, external_id)
  WHERE external_id IS NOT NULL;

-- ── 削除ジョブ用の部分索引 ────────────────────────────────────────
-- 対象は missing_since が付いた行だけなので、索引も同じ条件に絞る。
CREATE INDEX IF NOT EXISTS customer_list_rows_missing_since_idx
  ON public.customer_list_rows (missing_since)
  WHERE missing_since IS NOT NULL;

-- ── updated_at の自動更新（汎用トリガー関数）──────────────────────
-- NEW しか触らずテーブルを読まないため SECURITY INVOKER で足りる。
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.touch_updated_at() IS
  'BEFORE UPDATE で updated_at を now() に更新する汎用トリガー関数。NEW のみを触る。';

REVOKE ALL ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_touch_customer_list_rows_updated_at
  ON public.customer_list_rows;
CREATE TRIGGER trg_touch_customer_list_rows_updated_at
  BEFORE UPDATE ON public.customer_list_rows
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── PR-B が実装する missing_since の判定手順（ここでは実行しない・設計の申し送り）──
--   ① 取込開始時刻 t を控える
--   ② CSV の全行を UPSERT（衝突時は updated_at がトリガーで t 以降になる。
--      再出現した行は missing_since を NULL に戻す）
--   ③ UPDATE customer_list_rows
--        SET missing_since = now()
--      WHERE list_id = :list AND updated_at < :t AND missing_since IS NULL;
--      ＝「今回触られなかった行」だけに印を付ける。missing_since IS NULL の条件により
--        既に欠落印が付いた行の時刻は上書きされない（30 日の起算点が後ろにずれない）。
--   ⚠ ③ の UPDATE 自体もトリガーで updated_at を動かすが、上の IS NULL 条件があるため
--      次回以降に再度印を付け直すことはない。


-- =====================================================================
-- (2) sale_prediction_log（CL-23）
-- =====================================================================
-- 目的: 「世帯が減り高齢化した町域から売り物が出る」という売却発生スコアの仮説を、
--   実データ（顧客種別＝売主）で後から検証できるようにする台帳。
--
-- ⚠ 粒度は (組織 × 町域 × 予測基準月 × モデル版)。**個票粒度にしない**。
--   CL-02/CL-21 で「町域集計だけ保存／個人単位の年収・家族構成は DB に存在しない」が
--   確定している。予測を個票粒度で残すと「この個人は売主になる」という推定が個人に
--   紐づいて残り、その確定を裏口から破ることになる。
--
-- ⚠ hit/miss の判定列を持たない（原則1）。較正された閾値が無いまま「的中」を断定すると
--   推定に根拠のない精度を与えてしまう。**件数と母数だけを残し、判定は分析時に行う**。
--
-- ⚠ k 匿名化（n<5 は非表示）を保存側の CHECK にしない。母数が後から 5 を超えたときに
--   遡って記録できなくなるため。表示のゲートは読み取り経路（API/UI）の責務。
CREATE TABLE IF NOT EXISTS public.sale_prediction_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- RLS を join に依存させないための非正規化（customer_list_row_geocodes と同じ流儀）。
  organization_id       UUID NOT NULL REFERENCES public.organizations(id),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- ── 予測した対象 ───────────────────────────────────────────────
  -- 結合キーは既存の rankKey(municipality_id, 正規化町名) と同じ組にする。
  municipality_id       UUID NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  town_name_normalized  TEXT NOT NULL,
  -- 予測の根拠にした town_monthly_metrics の基準月。
  as_of                 DATE NOT NULL,

  -- ── 予測の中身 ─────────────────────────────────────────────────
  -- どの規則で出した予測かが判らないと「後から検証」が成立しない（規則改訂後に版を
  -- 混ぜて的中率を出すと無意味な数字になる）。PR#2/#3 の source_version と同じ考え方。
  model_version         TEXT NOT NULL,
  predicted_rank        TEXT NOT NULL
                          CHECK (predicted_rank IN ('S', 'A', 'B', 'C', 'D')),
  predicted_score       NUMERIC,
  predicted_reason      TEXT,          -- 推定には必ず根拠を残す（原則1）
  horizon_days          INTEGER NOT NULL CHECK (horizon_days > 0),
  predicted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ── 実際に何が起きたか（後から埋める）─────────────────────────────
  -- observed_at が NULL であること自体が「未検証」を意味する（状態フラグを別に持たない）。
  observed_at           TIMESTAMPTZ,
  observed_seller_count INTEGER,       -- その町域で実際に出た「売主」の件数
  observed_row_count    INTEGER,       -- 母数（その町域の名簿行数）
  source_list_id        UUID REFERENCES public.customer_lists(id) ON DELETE SET NULL,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 同じ (組織, 町域, 基準月, モデル版) を再計算しても増殖しない（冪等）。
  CONSTRAINT sale_prediction_log_grain_key
    UNIQUE (organization_id, municipality_id, town_name_normalized, as_of, model_version),

  -- 実測は「3 つ揃って入る」か「3 つとも空」のどちらか。中途半端な行を作らせない。
  CONSTRAINT sale_prediction_log_observation_consistency
    CHECK ((observed_at IS NULL) = (observed_seller_count IS NULL)
           AND (observed_at IS NULL) = (observed_row_count IS NULL)),
  CONSTRAINT sale_prediction_log_observation_sane
    CHECK (observed_seller_count IS NULL
           OR (observed_seller_count >= 0
               AND observed_row_count >= observed_seller_count))
);

COMMENT ON TABLE public.sale_prediction_log IS
  'CL-23: 売却発生スコアの検証台帳。粒度は (組織×町域×予測基準月×モデル版)。'
  '⛔ 個票粒度にしない（CL-02/CL-21「町域集計だけ保存」を裏口から破らないため）。'
  '⛔ hit/miss の判定列を持たない（較正された閾値が無いため・原則1）。件数と母数だけを残す。'
  'RLS は customer_list_row_geocodes と同型（SELECT=同一org共有 / 書込=作成者本人 AND org一致）。';
COMMENT ON COLUMN public.sale_prediction_log.model_version IS
  '予測を出した規則の版。これが無いと規則改訂後に版を混ぜた無意味な的中率になる。';
COMMENT ON COLUMN public.sale_prediction_log.observed_at IS
  '実測を記入した時刻。NULL であること自体が「未検証」を意味する（状態フラグを別に持たない）。';
COMMENT ON COLUMN public.sale_prediction_log.observed_seller_count IS
  'その町域で実際に出た売主の件数。k 匿名化（n<5 非表示）は保存側では強制しない'
  '（母数が後から 5 を超えたときに遡れなくなるため）。表示のゲートは読み取り経路の責務。';

CREATE INDEX IF NOT EXISTS sale_prediction_log_org_idx
  ON public.sale_prediction_log (organization_id);
CREATE INDEX IF NOT EXISTS sale_prediction_log_town_idx
  ON public.sale_prediction_log (municipality_id, town_name_normalized, as_of);
-- 未検証の行だけを拾う（検証バッチの入口）。
CREATE INDEX IF NOT EXISTS sale_prediction_log_unobserved_idx
  ON public.sale_prediction_log (predicted_at)
  WHERE observed_at IS NULL;

-- ── source_list_id を持つ行の org を親から継承する ────────────────────
-- 実測は「その組織の名簿」から作られる。org=A の予測行に org=B の名簿を紐づけられると、
-- A が B 由来の集計を見ることになる（テナント越えの漏洩）。親が指定されている場合は
-- 親の org で必ず上書きし、詐称を無効化する。
-- ⚠ SECURITY DEFINER なのは、書き手の RLS 可視範囲に関わらず親を読む必要があるため
--    （既存の set_customer_list_row_org / set_customer_list_row_geocode_owner と同じ理由・同じ search_path）。
CREATE OR REPLACE FUNCTION public.set_sale_prediction_log_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
BEGIN
  IF NEW.source_list_id IS NOT NULL THEN
    SELECT cl.organization_id INTO v_org
    FROM public.customer_lists cl
    WHERE cl.id = NEW.source_list_id;

    IF v_org IS NULL THEN
      RAISE EXCEPTION 'sale_prediction_log: 名簿 % が存在しません', NEW.source_list_id;
    END IF;
    NEW.organization_id := v_org;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_sale_prediction_log_org() IS
  'CL-23: source_list_id が指定されている行の organization_id を親 customer_lists から'
  '必ず上書きする（テナント越えの集計参照を構造的に防ぐ）。';

REVOKE ALL ON FUNCTION public.set_sale_prediction_log_org() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_set_sale_prediction_log_org ON public.sale_prediction_log;
CREATE TRIGGER trg_set_sale_prediction_log_org
  BEFORE INSERT OR UPDATE ON public.sale_prediction_log
  FOR EACH ROW EXECUTE FUNCTION public.set_sale_prediction_log_org();

DROP TRIGGER IF EXISTS trg_touch_sale_prediction_log_updated_at ON public.sale_prediction_log;
CREATE TRIGGER trg_touch_sale_prediction_log_updated_at
  BEFORE UPDATE ON public.sale_prediction_log
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── RLS（customer_list_row_geocodes と同型・CL-31）─────────────────
ALTER TABLE public.sale_prediction_log ENABLE ROW LEVEL SECURITY;

-- 関数呼び出しは行ごと再評価を避けるため必ず (select ...) / IN (SELECT ...) で包む。
DROP POLICY IF EXISTS "spl_select_org" ON public.sale_prediction_log;
CREATE POLICY "spl_select_org" ON public.sale_prediction_log
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.current_user_org_ids()));

DROP POLICY IF EXISTS "spl_insert_org" ON public.sale_prediction_log;
CREATE POLICY "spl_insert_org" ON public.sale_prediction_log
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (SELECT public.current_user_org_ids())
    AND user_id = (select auth.uid())
  );

DROP POLICY IF EXISTS "spl_update_org" ON public.sale_prediction_log;
CREATE POLICY "spl_update_org" ON public.sale_prediction_log
  FOR UPDATE TO authenticated
  USING (
    user_id = (select auth.uid())
    AND organization_id IN (SELECT public.current_user_org_ids())
  )
  WITH CHECK (
    user_id = (select auth.uid())
    AND organization_id IN (SELECT public.current_user_org_ids())
  );

DROP POLICY IF EXISTS "spl_delete_org" ON public.sale_prediction_log;
CREATE POLICY "spl_delete_org" ON public.sale_prediction_log
  FOR DELETE TO authenticated
  USING (
    user_id = (select auth.uid())
    AND organization_id IN (SELECT public.current_user_org_ids())
  );

-- ── テーブル権限の最小化（PR#2/#3 と同じ）──────────────────────────
-- anon には一切付けない。authenticated は SELECT のみ。予測と実測はサーバー側
-- （service_role）が算出して書く導出データで、クライアントが直接書き換える値ではない。
-- INSERT/UPDATE/DELETE のポリシーは、将来 GRANT が変わっても行レベルで守られるよう
-- 多層防御として先に置いてある。
REVOKE ALL ON public.sale_prediction_log FROM anon, authenticated;
GRANT SELECT ON public.sale_prediction_log TO authenticated;


-- =====================================================================
-- (3) 30日経過した missing_since 行の削除（CL-14 / CL-18）
-- =====================================================================
-- ⚠ 起動方法（O46）: **当面は PM の手動実行**とする。
--   本番の拡張構成を 8/20 オンボード直前に変更しないため、pg_cron は有効化しない
--   （実測: pg_cron / pg_net / pgmq はいずれも未インストール）。実名簿の投入は P1-2
--   施行後＝9 月以降で、それまで missing_since が付く行は発生しない。滞留しても
--   影響は容量だけ。将来 pg_cron へ移す場合は拡張を有効化して
--     SELECT cron.schedule('purge-missing-rows', '0 3 * * *',
--                          $$SELECT public.purge_missing_customer_list_rows();$$);
--   の 1 行を足すだけでよい（関数側の変更は不要）。
--   ⛔ 本 migration ではスケジュール登録を一切行わない。
--
-- SECURITY INVOKER であることの帰結（意図的な設計）:
--   service_role が呼べば RLS をバイパスして全組織分を削除する（保守ジョブ用）。
--   authenticated が呼べば RLS（clr_delete_org = 作成者本人 AND org 一致）により
--   自分の行しか消えない。⛔ RLS を緩めないまま両方の用途で安全に使える。
--   EXECUTE は service_role にのみ付与する（authenticated には付けない）。
CREATE OR REPLACE FUNCTION public.purge_missing_customer_list_rows(
  p_retention_days integer DEFAULT 30
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  -- 0 や負値を渡して「印を付けた直後の行まで消す」事故を防ぐ（最短 1 日）。
  v_days    integer := greatest(coalesce(p_retention_days, 30), 1);
  v_deleted integer;
BEGIN
  DELETE FROM public.customer_list_rows
  WHERE missing_since IS NOT NULL
    AND missing_since < now() - make_interval(days => v_days);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.purge_missing_customer_list_rows(integer) IS
  'CL-14/CL-18: missing_since が p_retention_days（既定 30・最短 1）日より前の '
  'customer_list_rows を削除し、削除件数を返す。FK CASCADE により '
  'customer_list_row_geocodes / customer_list_row_school_districts の該当行も消える。'
  'SECURITY INVOKER: service_role なら全組織、authenticated なら RLS により自分の行のみ。'
  '起動は当面 PM の手動実行。将来 pg_cron へ移行可（O46）。';

REVOKE ALL ON FUNCTION public.purge_missing_customer_list_rows(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_missing_customer_list_rows(integer)
  TO service_role;

COMMIT;


-- =====================================================================
-- ロールバック SQL（適用を取り消す場合・PM が手動実行）:
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.purge_missing_customer_list_rows(integer);
--   DROP TABLE IF EXISTS public.sale_prediction_log;          -- ⚠ 予測ログも消える
--   DROP FUNCTION IF EXISTS public.set_sale_prediction_log_org();
--   DROP TRIGGER IF EXISTS trg_touch_customer_list_rows_updated_at
--     ON public.customer_list_rows;
--   DROP INDEX IF EXISTS public.customer_list_rows_missing_since_idx;
--   DROP INDEX IF EXISTS public.customer_list_rows_external_id_key;
--   ALTER TABLE public.customer_list_rows                      -- ⚠ 入力済みの値も消える
--     DROP COLUMN IF EXISTS updated_at,
--     DROP COLUMN IF EXISTS desired_muni_code_5,
--     DROP COLUMN IF EXISTS desired_school,
--     DROP COLUMN IF EXISTS missing_since,
--     DROP COLUMN IF EXISTS external_id;
--   DROP FUNCTION IF EXISTS public.touch_updated_at();         -- ⚠ 他表で使い始めていたら残すこと
--   COMMIT;
--   -- ⛔ set_customer_list_row_org() は既存資産。DROP しないこと。
-- =====================================================================


-- =====================================================================
-- 検証クエリ（適用後に手動実行）
-- =====================================================================
--
-- ── ① 列が 18 → 23 になり、既存 48 行が壊れていないこと ──────────────
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='customer_list_rows'
--     AND column_name IN ('external_id','missing_since','desired_school',
--                         'desired_muni_code_5','updated_at')
--   ORDER BY column_name;
--   -- 期待: 5 行。updated_at のみ is_nullable='NO' かつ default='now()'、他は YES/NULL。
--
--   SELECT count(*) AS rows,
--          count(*) FILTER (WHERE updated_at IS NOT NULL) AS has_updated_at,
--          count(*) FILTER (WHERE external_id IS NOT NULL) AS has_external_id,
--          count(*) FILTER (WHERE missing_since IS NOT NULL) AS marked_missing
--   FROM public.customer_list_rows;
--   -- 期待: rows=48 / has_updated_at=48 / has_external_id=0 / marked_missing=0
--
--   -- 既存の CHECK・トリガーが増減していないこと:
--   SELECT conname FROM pg_constraint
--   WHERE conrelid='public.customer_list_rows'::regclass AND contype='c';
--   -- 期待: customer_list_rows_match_status_check の 1 本のみ（増えていない）
--   SELECT tgname FROM pg_trigger
--   WHERE tgrelid='public.customer_list_rows'::regclass AND NOT tgisinternal ORDER BY 1;
--   -- 期待: trg_set_customer_list_row_org / trg_touch_customer_list_rows_updated_at の 2 本
--
-- ── ② UPSERT キー（CL-09）が効いていること ────────────────────────
--   SELECT indexdef FROM pg_indexes
--   WHERE schemaname='public' AND indexname='customer_list_rows_external_id_key';
--   -- 期待: UNIQUE ... (list_id, external_id) WHERE (external_id IS NOT NULL)
--
--   -- ⚠ service_role で実行（RLS を跨ぐため）。テスト用の list_id を 1 つ選ぶ:
--   --   同じ (list_id, external_id) の二重登録が弾かれること:
--   --     → 2 回目の INSERT が 23505 unique_violation になれば正しい。
--   --   external_id が NULL の行は何行でも入れられること（衝突しない）:
--   --     → 同じ list_id に NULL を 2 行入れてもエラーにならなければ正しい。
--   --   ⛔ 検証後に作ったテスト行は必ず削除すること。
--
-- ── ③ updated_at トリガーが動くこと ──────────────────────────────
--   -- service_role で任意の 1 行を選び、値を変えない UPDATE をしても updated_at が進む:
--   --   SELECT id, updated_at FROM public.customer_list_rows LIMIT 1;
--   --   UPDATE public.customer_list_rows SET row_no = row_no WHERE id = :id;
--   --   SELECT id, updated_at FROM public.customer_list_rows WHERE id = :id;
--   -- 期待: updated_at が UPDATE 実行時刻に進んでいる
--   --       （「今回の取込で触られたか」の判定はこの性質に依存する・CL-17）
--
-- ── ④ sale_prediction_log の構造 ────────────────────────────────
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid='public.sale_prediction_log'::regclass ORDER BY contype, conname;
--   -- 期待: grain_key(UNIQUE 5列) / observation_consistency / observation_sane /
--   --       predicted_rank・horizon_days の CHECK / FK 4 本 / PK
--
--   -- 実測 3 列の「揃って入るか揃って空か」が守られること（service_role で実行）:
--   --   observed_at だけを入れた INSERT が 23514 check_violation になれば正しい。
--   -- 売主件数が母数を超える行が弾かれること:
--   --   observed_seller_count=5 / observed_row_count=3 が 23514 になれば正しい。
--   -- 同一粒度の二重登録が弾かれること:
--   --   同じ (organization_id, municipality_id, town_name_normalized, as_of, model_version)
--   --   の 2 回目が 23505 になれば正しい。
--   ⛔ 検証後に作ったテスト行は必ず削除すること。
--
-- ── ⑤ テナント越えの継承が効いていること ───────────────────────────
--   -- org=A を明示しつつ org=B の名簿を source_list_id に指定して INSERT し、
--   -- 保存された organization_id が **B**（親の org）に上書きされていること。
--   -- 存在しない source_list_id を渡すと「名簿 ... が存在しません」で失敗すること。
--
-- ── ⑥ 削除関数 ──────────────────────────────────────────────
--   -- 空振り（対象 0 件）で 0 を返すこと:
--   SELECT public.purge_missing_customer_list_rows();          -- 期待: 0
--   -- 保持日数の下限が効くこと（0 を渡しても 1 日未満は消えない）:
--   --   テスト行に missing_since = now() を付けてから
--   SELECT public.purge_missing_customer_list_rows(0);         -- 期待: 0（直前の行は消えない）
--   --   missing_since = now() - interval '31 days' の行を作れば 1 が返り、
--   --   customer_list_row_geocodes / customer_list_row_school_districts の該当行も
--   --   FK CASCADE で消えていること。
--   ⛔ 検証後に作ったテスト行は必ず削除すること。
--
-- ── ⑦ RLS / 権限 ────────────────────────────────────────────
--   SELECT relrowsecurity FROM pg_class
--   WHERE oid='public.sale_prediction_log'::regclass;                       -- 期待: t
--   SELECT policyname, cmd FROM pg_policies
--   WHERE schemaname='public' AND tablename='sale_prediction_log' ORDER BY cmd;
--   -- 期待: spl_* の 4 本
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_schema='public' AND table_name='sale_prediction_log' ORDER BY 1,2;
--   -- 期待: authenticated=SELECT のみ。anon は 1 件も出ない
--   SELECT p.proname, array_to_string(p.proacl::text[], ' | ') AS acl
--   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--   WHERE n.nspname='public'
--     AND p.proname IN ('purge_missing_customer_list_rows','touch_updated_at',
--                       'set_sale_prediction_log_org')
--   ORDER BY 1;
--   -- 期待: どれにも anon= が含まれない。
--   --       purge_missing_customer_list_rows は service_role=X のみ
--   --       （authenticated=X が含まれていたら GRANT が緩んでいる）
--   -- anon / authenticated は EXECUTE 拒否:
--   SET ROLE anon;
--   SELECT public.purge_missing_customer_list_rows();   -- 期待: ERROR permission denied
--   RESET ROLE;
--
--   -- ⛔ 既存の customer_list_rows の RLS 4 本が変わっていないこと（緩めていない証拠）:
--   SELECT policyname, cmd, qual, with_check FROM pg_policies
--   WHERE schemaname='public' AND tablename='customer_list_rows' ORDER BY cmd;
--   -- 期待: clr_select_org / clr_insert_org / clr_update_org / clr_delete_org が
--   --       適用前と一字一句同じ（本 migration は列を足すだけで RLS に触れていない）
-- =====================================================================

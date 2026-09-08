-- =====================================================================
-- 20260908000100_bm_property_types_lead_type.sql
-- 購入希望マッチ（BM）PR-BM-1 / c1: 物件種別マスタ・lead_type 列・
--   顧客行×物件種別（希望価格帯）子テーブルを新設する。
--   決定: Vault 2026-09-03_Decision_購入希望マッチ設計（仮番 -bm-）。設計書 §7 参照。
--   ⚠ -bm- は「仮番」。本 migration で仮番を新設・変更・採番しない。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う（R7・D57）。
--   ※ supabase db push は恒久禁止。
--
-- 本 migration が作るもの:
--   (1) public.property_types                      … 物件種別マスタ（6値・FK 担保）
--   (2) public.customer_list_rows.lead_type        … 買/売/不明の区分列（NOT NULL DEFAULT 'unknown'）
--   (3) public.set_customer_list_row_child_owner() … BM 子テーブル用の所有情報上書きトリガー関数
--   (3) public.customer_list_row_property_types     … 顧客行×物件種別（希望価格帯・洗い替え運用）
--
-- ⛔ 本 migration に含めないもの（BM-2 以降の範囲）:
--   lead_type の正規化辞書（TS の1箇所で定義）・既存行の backfill・取込/UPSERT ロジック・
--   読取 RPC・API・UI・price の永続化配線。property_types の出店系 INSERT は運用時に行う。
--
-- 前提（手順1 で実測・PM 照合済み・推測ではない）:
--   - 台帳最新は 20260826000200。本ファイルはその後ろに採番。
--   - customer_list_rows は 27 列。lead_type / property_type 系の列は未存在。
--     CHECK は customer_list_rows_match_status_check の 1 本のみ。deleted_at は既存列。
--   - customer_list_row_geocodes（M2-5b）は RLS 4 本（clrg_*・org 方針）＋ SELECT のみ GRANT。
--     所有情報上書きは set_customer_list_row_geocode_owner()（DEFINER）だが、UPDATE 分岐で
--     NEW.updated_at を参照し RAISE にテーブル名を固定しているため、updated_at を持たない
--     本 PR の子テーブルでは流用不能。→ updated_at 分岐を持たない兄弟関数を (3) で新設する。
--   - public.current_user_org_ids() は既存（geocodes の RLS が参照している同関数を用いる）。
--
-- ⚠ RLS/GRANT/トリガーは customer_list_row_geocodes（clrg_*）と同型・逐語コピーで、
--   緩めない。子テーブルは洗い替え運用のため updated_at を持たず created_at のみ。
-- =====================================================================

BEGIN;


-- =====================================================================
-- (1) 物件種別マスタ
-- =====================================================================
-- code は CHECK で固定せず FK で担保する（追加種別は運用時 INSERT で足せる）。
-- other は置かない。出店系（事業用の細分等）は運用時 INSERT で足す。
CREATE TABLE public.property_types (
  code        text PRIMARY KEY,
  label_ja    text NOT NULL,
  segment     text NOT NULL CHECK (segment IN ('residential','commercial')),
  sort_order  smallint NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.property_types (code, label_ja, segment, sort_order) VALUES
  ('new_detached','新築戸建','residential',10),
  ('used_detached','中古戸建','residential',20),
  ('new_condo','新築マンション','residential',30),
  ('used_condo','中古マンション','residential',40),
  ('land','土地','residential',50),
  ('commercial','事業用','commercial',60);
ALTER TABLE public.property_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY property_types_select ON public.property_types FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.property_types FROM PUBLIC, anon;
GRANT SELECT ON public.property_types TO authenticated;
COMMENT ON TABLE public.property_types IS '物件種別マスタ（BM・D-bm-b 仮番）。code は CHECK で固定せず FK で担保。出店系は運用時 INSERT';


-- =====================================================================
-- (2) customer_list_rows.lead_type
-- =====================================================================
-- 買/売/不明の区分。正規化辞書は SQL に置かない（BM-2 で TS の1箇所）。
-- DB 側は NOT NULL DEFAULT 'unknown' と CHECK のみ。既存行の backfill はしない
-- （追加後は全行 'unknown'）。RLS 4 本・トリガー 2 本・既存 CHECK は触らない。
ALTER TABLE public.customer_list_rows
  ADD COLUMN IF NOT EXISTS lead_type text NOT NULL DEFAULT 'unknown';
ALTER TABLE public.customer_list_rows
  ADD CONSTRAINT customer_list_rows_lead_type_check CHECK (lead_type IN ('buy','sell','unknown'));
CREATE INDEX IF NOT EXISTS customer_list_rows_list_lead_type_idx
  ON public.customer_list_rows (list_id, lead_type) WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.customer_list_rows.lead_type IS
  'BM（D-bm- 仮番）: 反響の区分。buy=買い問合せ / sell=売却査定 / unknown=未判定。'
  'NOT NULL DEFAULT ''unknown''。正規化辞書は BM-2 の TS 側に置き、DB は CHECK のみ。'
  '既存行の backfill はしない（追加直後は全行 unknown）。';


-- =====================================================================
-- (3) BM 子テーブル用の所有情報上書きトリガー関数（兄弟関数）
-- =====================================================================
-- geocodes 版 set_customer_list_row_geocode_owner() と同じく NEW.row_id から親
--   customer_list_rows を引いて list_id/user_id/organization_id を必ず上書きする
--   （詐称不能・親子 org 一致を構造で保証）。差分は 2 点のみ:
--     - updated_at 分岐を持たない（本 PR の子テーブルは洗い替え運用で updated_at 列を持たない）。
--     - RAISE のテーブル名を TG_TABLE_NAME にして 2 テーブルで共用できるようにする。
-- SECURITY DEFINER は「書き手の RLS 可視範囲に関わらず親を読む」ため（既存 DEFINER 関数と同じ理由・同じ search_path）。
CREATE OR REPLACE FUNCTION public.set_customer_list_row_child_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  SELECT r.list_id, r.user_id, r.organization_id
    INTO NEW.list_id, NEW.user_id, NEW.organization_id
  FROM public.customer_list_rows r
  WHERE r.id = NEW.row_id;

  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION '%: 親行 % が存在しません', TG_TABLE_NAME, NEW.row_id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_customer_list_row_child_owner() FROM public, anon;

COMMENT ON FUNCTION public.set_customer_list_row_child_owner() IS
  'BM-1（D-bm- 仮番）: BM 子テーブル（customer_list_row_property_types / '
  'customer_list_row_desired_districts）の list_id/user_id/organization_id を親 '
  'customer_list_rows から必ず上書きする（詐称不能・親子 org 一致を保証）。'
  'geocodes 版から updated_at 分岐を除き RAISE を TG_TABLE_NAME で共用する兄弟関数。';


-- =====================================================================
-- (3-table) customer_list_row_property_types（顧客行×物件種別・希望価格帯）
-- =====================================================================
-- 1 行 = 1 顧客行の 1 希望物件種別（価格帯付き）。洗い替え運用のため created_at のみ。
-- list_id/user_id/organization_id は親から上書き（トリガー）。geocodes と同じ 3 列構成。
CREATE TABLE public.customer_list_row_property_types (
  row_id          uuid NOT NULL REFERENCES public.customer_list_rows(id) ON DELETE CASCADE,
  property_type   text NOT NULL REFERENCES public.property_types(code),
  price_min       integer,   -- 万円
  price_max       integer,   -- 万円
  is_primary      boolean NOT NULL DEFAULT false,
  list_id         uuid NOT NULL,   -- 親から上書き（トリガー）
  user_id         uuid NOT NULL,   -- 同上（geocodes と同じ3列構成）
  organization_id uuid NOT NULL,   -- 同上
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (row_id, property_type),
  CHECK (price_min IS NULL OR price_min >= 0),
  CHECK (price_max IS NULL OR price_max >= 0),
  CHECK (price_min IS NULL OR price_max IS NULL OR price_min <= price_max)
);
CREATE INDEX ON public.customer_list_row_property_types (list_id, property_type);

COMMENT ON TABLE public.customer_list_row_property_types IS
  'BM-1（D-bm- 仮番）: 顧客行の希望物件種別と価格帯（万円）。property_type は property_types(code) を FK 参照。'
  '洗い替え運用のため created_at のみ（updated_at は持たない）。'
  'RLS は customer_list_row_geocodes と同型（SELECT=同一 org 共有 / 書込=作成者本人 AND org 一致）。';
COMMENT ON COLUMN public.customer_list_row_property_types.price_min IS '希望価格の下限（万円）。NULL=未指定。price_max との整合は CHECK で担保。';
COMMENT ON COLUMN public.customer_list_row_property_types.price_max IS '希望価格の上限（万円）。NULL=未指定。';

-- ── 親行から所有情報を継承するトリガー（親子の org 不一致を構造的に防止・BEFORE INSERT OR UPDATE）──
DROP TRIGGER IF EXISTS trg_set_customer_list_row_property_type_owner
  ON public.customer_list_row_property_types;
CREATE TRIGGER trg_set_customer_list_row_property_type_owner
  BEFORE INSERT OR UPDATE ON public.customer_list_row_property_types
  FOR EACH ROW EXECUTE FUNCTION public.set_customer_list_row_child_owner();

-- ── RLS（customer_list_row_geocodes の clrg_* 4 本を逐語コピー・緩めない）──────
ALTER TABLE public.customer_list_row_property_types ENABLE ROW LEVEL SECURITY;

-- 関数呼び出しは行ごと再評価を避けるため必ず (select ...) / IN (SELECT ...) で包む。
DROP POLICY IF EXISTS "clrpt_select_org" ON public.customer_list_row_property_types;
CREATE POLICY "clrpt_select_org" ON public.customer_list_row_property_types
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.current_user_org_ids()));

DROP POLICY IF EXISTS "clrpt_insert_org" ON public.customer_list_row_property_types;
CREATE POLICY "clrpt_insert_org" ON public.customer_list_row_property_types
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (SELECT public.current_user_org_ids())
    AND user_id = (select auth.uid())
  );

DROP POLICY IF EXISTS "clrpt_update_org" ON public.customer_list_row_property_types;
CREATE POLICY "clrpt_update_org" ON public.customer_list_row_property_types
  FOR UPDATE TO authenticated
  USING (
    user_id = (select auth.uid())
    AND organization_id IN (SELECT public.current_user_org_ids())
  )
  WITH CHECK (
    user_id = (select auth.uid())
    AND organization_id IN (SELECT public.current_user_org_ids())
  );

DROP POLICY IF EXISTS "clrpt_delete_org" ON public.customer_list_row_property_types;
CREATE POLICY "clrpt_delete_org" ON public.customer_list_row_property_types
  FOR DELETE TO authenticated
  USING (
    user_id = (select auth.uid())
    AND organization_id IN (SELECT public.current_user_org_ids())
  );

-- ── テーブル権限の最小化（geocodes と同一）──────────────────────────
-- anon には一切付けない。authenticated は SELECT のみ。書込は取り込み時のサーバー側
-- （service_role）が行う導出データ。INSERT/UPDATE/DELETE ポリシーは多層防御として先に置く。
REVOKE ALL ON public.customer_list_row_property_types FROM anon, authenticated;
GRANT SELECT ON public.customer_list_row_property_types TO authenticated;

COMMIT;


-- =====================================================================
-- ロールバック SQL（適用を取り消す場合・PM が手動実行）:
--   BEGIN;
--   DROP TABLE IF EXISTS public.customer_list_row_property_types;   -- ⚠ 入力済みの希望価格帯も消える
--   DROP FUNCTION IF EXISTS public.set_customer_list_row_child_owner();
--     -- ⚠ 20260908000200 の desired_districts でも使用する。両方を切り戻す場合のみ DROP すること。
--   DROP INDEX IF EXISTS public.customer_list_rows_list_lead_type_idx;
--   ALTER TABLE public.customer_list_rows
--     DROP CONSTRAINT IF EXISTS customer_list_rows_lead_type_check,
--     DROP COLUMN IF EXISTS lead_type;                              -- ⚠ 入力済みの区分も消える
--   DROP TABLE IF EXISTS public.property_types;
--   COMMIT;
-- =====================================================================


-- =====================================================================
-- 検証クエリ（適用後に手動実行・詳細は scripts/sql/verify_bm1_schema.sql）
-- =====================================================================
--
-- ── ① property_types が 6 件・code 一覧 ────────────────────────────
--   SELECT code, label_ja, segment, sort_order FROM public.property_types ORDER BY sort_order;
--   -- 期待: new_detached/used_detached/new_condo/used_condo/land/commercial の 6 件。
--
-- ── ② lead_type の分布（適用直後は全行 'unknown'）────────────────────
--   SELECT lead_type, count(*) FROM public.customer_list_rows GROUP BY 1 ORDER BY 1;
--   -- 期待: unknown=全件（buy/sell は 0）。
--
-- ── ③ customer_list_rows の RLS 4 本と既存 CHECK が不変であること ───────
--   SELECT policyname, cmd, qual, with_check FROM pg_policies
--   WHERE schemaname='public' AND tablename='customer_list_rows' ORDER BY cmd;
--   -- 期待: clr_select_org / clr_insert_org / clr_update_org / clr_delete_org が一字一句同じ。
--   SELECT conname FROM pg_constraint
--   WHERE conrelid='public.customer_list_rows'::regclass AND contype='c' ORDER BY 1;
--   -- 期待: customer_list_rows_lead_type_check / customer_list_rows_match_status_check の 2 本。
--
-- ── ④ 子テーブルの RLS/GRANT/トリガーが geocodes と同型であること ─────────
--   SELECT policyname, cmd, qual, with_check FROM pg_policies
--   WHERE schemaname='public' AND tablename='customer_list_row_property_types' ORDER BY cmd;
--   -- 期待: clrpt_* の 4 本が clrg_* と同じ述語。
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_schema='public' AND table_name='customer_list_row_property_types' ORDER BY 1,2;
--   -- 期待: authenticated=SELECT のみ。anon は 1 件も出ない。
-- =====================================================================

-- =====================================================================
-- 20260821000000_customer_list_optout_deleted.sql
-- PR-D改 c1 / O54・O55: customer_list_rows に「オプトアウト保存列 3 本」と
--   「削除フラグ（deleted_at）」を追加する（列追加のみ・RLS は一切変更しない）。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う（R7・D57）。
--   ※ supabase db push は恒久禁止。
--
-- 本 migration が作るもの:
--   public.customer_list_rows への列追加 4 本
--     - opt_out_dm            BOOLEAN NOT NULL DEFAULT false  ← CSV 72列「DM郵送希望」
--     - opt_out_mail_magazine BOOLEAN NOT NULL DEFAULT false  ← CSV 89列「メルマガフラグ（メール営業対象者フラグ）」
--     - opt_out_mail          BOOLEAN NOT NULL DEFAULT false  ← CSV 90列「メール禁止フラグ」
--     - deleted_at            TIMESTAMPTZ NULL DEFAULT NULL    ← CSV 123列「削除フラグ」の反映先
--   ＋ deleted_at の部分索引 1 本（アタックリスト除外の絞り込み用）。
--
-- ⛔ 本 migration に含めないもの（c2/c3/c4 の範囲）:
--   パーサのフラグ判定・プリセットの列マッピング・突合結線・attack-list の除外クエリ。
--   突合バッチ RPC（match_customer_list_rows）は c2 の別 migration。
--
-- 前提（PM 実測・推測ではない）:
--   - 台帳最新は 20260818100000（csv_import_schema）。本ファイルはその後ろに採番。
--   - customer_list_rows は 20260818100000 適用後 23 列。追加 4 列はいずれも未存在。
--   - CSV のフラグ列（1-based）: 72=DM郵送希望 / 89=メルマガフラグ / 90=メール禁止フラグ /
--     91=メール禁止日時 / 123=削除フラグ。値の解釈は「空文字=OFF / 非空(実測'1')=ON」。
--     ⛔ 列数（174）は指紋・バリデーション条件にしない（O56）。91（メール禁止日時）は
--        オプトアウト3列（72/89/90）に含めない裁定のため列を作らない。
--
-- ⚠ 命名と除外方針について（裁定C=c6 で訂正済み）:
--   3 本の BOOLEAN は「CRM 側のフラグが ON（非空）か」を **そのまま真偽で保持** する
--   （true = 当該フラグが ON）。値は事実の写しであり、除外の可否（表示ロジック）は
--   読み取り側の責務として分離する（原則1: 保存と判定を混ぜない）。
--   ※ 当初 O55 はこの 3 列を「オプトアウト3列＝ON なら表示除外」と束ねていたが、
--     72「DM郵送希望」/ 89「メール営業対象者フラグ」は CRM 実ヘッダの語義がオプトイン
--     （希望・営業対象）であり ON=除外は逆効果。よって **裁定C で attack-list の除外は
--     90「メール禁止フラグ」(opt_out_mail) のみへ訂正済み**。72/89 は保存のみで除外に使わない。
--     （O55 の語義訂正は Vault 側で PM が転記する。）
--
-- ⚠ deleted_at の運用規則（裁定A=③改・c3 が実装。ここでは列だけ用意する）:
--   - CSV の削除フラグ ON 行:
--       (a) external_id が DB に既存 → 内容は更新せず deleted_at=now() のみ設定（既設なら維持）
--       (b) DB に未存在           → 行を作らない（取り込まない・O54 の原義）
--   - 削除フラグ OFF 行で deleted_at が立っている既存行 → deleted_at=NULL へ戻す（CRM を正とする）
--   - c2 の突合対象は deleted_at IS NULL の行のみ。attack-list も deleted_at IS NOT NULL を除外。
--
-- ⛔ RLS は一切変更しない: 既存の customer_list_rows の 4 本
--   （clr_select_org / clr_insert_org / clr_update_org / clr_delete_org）はいずれも
--   列非依存のため、本 migration の列追加では影響を受けない（緩めない・触れない）。
-- =====================================================================

BEGIN;

-- =====================================================================
-- (1) customer_list_rows への列追加
-- =====================================================================
-- BOOLEAN 3 本は NOT NULL DEFAULT false。deleted_at は NULL 許容・既定 NULL。
-- 既存行（少数）は追加後すべて false / NULL になる。定数 DEFAULT の ADD COLUMN は
-- PG11 以降テーブル書き換えを伴わない。既存の CHECK（match_status）・FK・RLS・
-- トリガーは列非依存のため影響しない。
ALTER TABLE public.customer_list_rows
  ADD COLUMN IF NOT EXISTS opt_out_dm            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS opt_out_mail_magazine BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS opt_out_mail          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at            TIMESTAMPTZ;

COMMENT ON COLUMN public.customer_list_rows.opt_out_dm IS
  'O55/裁定C: CSV 72列「DM郵送希望」フラグの ON/OFF（非空=ON=true / 空=OFF=false）。'
  '保存のみ。attack-list の除外条件には使わない（裁定C: ヘッダの語義がオプトイン＝希望のため、'
  'ON=除外は逆効果）。事実（CRM フラグの ON/OFF）は保持し、除外判定には用いない。';
COMMENT ON COLUMN public.customer_list_rows.opt_out_mail_magazine IS
  'O55/裁定C: CSV 89列「メルマガフラグ（メール営業対象者フラグ）」の ON/OFF（非空=ON=true）。'
  '保存のみ。attack-list の除外条件には使わない（裁定C: 語義がオプトイン＝営業対象のため）。';
COMMENT ON COLUMN public.customer_list_rows.opt_out_mail IS
  'O55/裁定C: CSV 90列「メール禁止フラグ」の ON/OFF（非空=ON=true）。'
  'attack-list の除外に使う唯一の列（裁定C: 名実ともに禁止）。true の行は表示除外する（除外は c3/c6）。';
COMMENT ON COLUMN public.customer_list_rows.deleted_at IS
  'O54（裁定A=③改）: CSV 123列「削除フラグ」ON を反映する時刻。NULL=現存。'
  'CSV 削除フラグ ON かつ external_id が DB 既存の行に now() を設定（内容は更新しない）。'
  '削除フラグ OFF で再出現したら NULL に戻す（CRM を正とする）。'
  'c2 の突合対象および attack-list 表示はいずれも deleted_at IS NULL の行に限る。';

-- ── deleted_at の部分索引（削除済みを attack-list から絞る/除外する経路の索引）──
-- 対象は deleted_at が立った行だけなので、索引も同じ条件に絞る（missing_since 索引と同じ流儀）。
CREATE INDEX IF NOT EXISTS customer_list_rows_deleted_at_idx
  ON public.customer_list_rows (deleted_at)
  WHERE deleted_at IS NOT NULL;

COMMIT;


-- =====================================================================
-- ロールバック SQL（適用を取り消す場合・PM が手動実行）:
--   BEGIN;
--   DROP INDEX IF EXISTS public.customer_list_rows_deleted_at_idx;
--   ALTER TABLE public.customer_list_rows                      -- ⚠ 入力済みの値も消える
--     DROP COLUMN IF EXISTS deleted_at,
--     DROP COLUMN IF EXISTS opt_out_mail,
--     DROP COLUMN IF EXISTS opt_out_mail_magazine,
--     DROP COLUMN IF EXISTS opt_out_dm;
--   COMMIT;
-- =====================================================================


-- =====================================================================
-- 検証クエリ（適用後に手動実行）
-- =====================================================================
--
-- ── ① 列が 4 本増え、既存行が壊れていないこと ─────────────────────────
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='customer_list_rows'
--     AND column_name IN ('opt_out_dm','opt_out_mail_magazine','opt_out_mail','deleted_at')
--   ORDER BY column_name;
--   -- 期待: 4 行。opt_out_* は data_type=boolean / is_nullable='NO' / default='false'、
--   --       deleted_at は timestamp with time zone / is_nullable='YES' / default IS NULL。
--
--   SELECT count(*) AS rows,
--          count(*) FILTER (WHERE opt_out_dm)            AS dm_on,
--          count(*) FILTER (WHERE opt_out_mail_magazine) AS mm_on,
--          count(*) FILTER (WHERE opt_out_mail)          AS mail_on,
--          count(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted
--   FROM public.customer_list_rows;
--   -- 期待: 既存行はすべて dm_on=0 / mm_on=0 / mail_on=0 / deleted=0。
--
-- ── ② 既存の CHECK・トリガー・RLS が増減していないこと（緩めていない証拠）──────
--   SELECT conname FROM pg_constraint
--   WHERE conrelid='public.customer_list_rows'::regclass AND contype='c';
--   -- 期待: customer_list_rows_match_status_check の 1 本のみ（増えていない）。
--   SELECT tgname FROM pg_trigger
--   WHERE tgrelid='public.customer_list_rows'::regclass AND NOT tgisinternal ORDER BY 1;
--   -- 期待: trg_set_customer_list_row_org / trg_touch_customer_list_rows_updated_at の 2 本。
--   SELECT policyname, cmd, qual, with_check FROM pg_policies
--   WHERE schemaname='public' AND tablename='customer_list_rows' ORDER BY cmd;
--   -- 期待: clr_select_org / clr_insert_org / clr_update_org / clr_delete_org が
--   --       適用前と一字一句同じ（本 migration は列を足すだけで RLS に触れていない）。
--
-- ── ③ 部分索引が効いていること ───────────────────────────────────
--   SELECT indexdef FROM pg_indexes
--   WHERE schemaname='public' AND indexname='customer_list_rows_deleted_at_idx';
--   -- 期待: ... (deleted_at) WHERE (deleted_at IS NOT NULL)
-- =====================================================================

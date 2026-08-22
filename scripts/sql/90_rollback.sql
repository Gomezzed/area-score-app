-- =====================================================================
-- scripts/sql/90_rollback.sql  （M1-11 / 個別切り戻し）
--
-- 目的: 10〜30 を個別に切り戻す。各セクションが「何を戻すか」をコメントで明示する。
--       セクションは独立。必要なものだけを選んで実行してよい。
--
-- 実行者: PM が Supabase コネクタ（service_role 文脈）で実行。
-- 想定影響行数: 各セクション最大 34（対象ユーザー）＋法人数。
--
-- ⚠ 依存関係（適用の逆順で戻すのが安全）:
--     (R3 subscriptions) → (R1 個人membership復元) → (R2 法人membership除去) → (R4 法人org削除)
--   個人 membership を先に戻してから法人 membership を外すと所属 org ゼロ窓を作らない。
--
-- 【重要】(R1) 個人 org の復元は 25 の DELETE...RETURNING 出力が唯一の材料。
--   membership を消すと user↔個人org の紐付けが失われるため、25 実行時の出力を
--   必ず控えておくこと（個人 org の行自体は 25 で消していないので残っている）。
-- =====================================================================

-- ─── 対応表（唯一の正・★PM がここだけ差し替える）─────────────────────────
CREATE TEMP TABLE IF NOT EXISTS m1_11_roster (email text, corp_name text);
TRUNCATE m1_11_roster;
INSERT INTO m1_11_roster (email, corp_name) VALUES
  ('tencho1@example.com', 'サンプル不動産株式会社'),
  ('tencho2@example.com', 'サンプル不動産株式会社');
  -- ここに残り32行を追加（合計34行）
-- ─────────────────────────────────────────────────────────────────────


-- =====================================================================
-- (R1) 25 の逆: 個人 org membership を復元する。
--   ★ 25_remove_personal_membership.sql の DELETE...RETURNING が出力した
--     (organization_id, user_id, role) をそのまま下記 VALUES に貼ること。
--     貼らなければ個人 org の復元はできない（紐付け情報は RETURNING だけが持つ）。
--   role を復元する逆 INSERT（裁定2 ③）。冪等（ON CONFLICT DO NOTHING）。
-- =====================================================================
-- ↓↓↓ ここに 25 の RETURNING 出力を貼る（下記1行は example のダミー・要差し替え）↓↓↓
INSERT INTO public.organization_members (organization_id, user_id, role)
VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid,
   '00000000-0000-0000-0000-000000000000'::uuid,
   'owner')   -- ★サンプル。25 の RETURNING 実データへ全置換すること
ON CONFLICT (organization_id, user_id) DO NOTHING;
-- ↑↑↑ ここまで差し替え ↑↑↑


-- =====================================================================
-- (R2) 20 の逆: 20 で付与した法人 org membership を除去する。
--   法人 org は 10 で新規作成した is_personal=false の org。そこへの対象ユーザーの
--   membership は 20 で追加したものなので削除して安全（対応表結合で既存ユーザー除外）。
-- =====================================================================
DELETE FROM public.organization_members om
USING m1_11_roster r,
      auth.users u,
      public.organizations o
WHERE lower(u.email) = lower(r.email)
  AND om.user_id = u.id
  AND o.id = om.organization_id
  AND o.is_personal = false
  AND o.name = r.corp_name;


-- =====================================================================
-- (R3) 30 の逆: subscriptions のコンプ付与を戻す。
--   ⚠ 事前状態は #6 の整理どおり「対象は free 登録者（customer_lists 0 件）」を前提とすると、
--     多くは昇格前に subscriptions 行が無かった可能性が高い。ただし確証は 00_baseline_select.sql
--     の (S1b)/(S3) 出力が唯一の pre-image。PM は 00 の出力を見て下記のどちらかを選ぶこと。
--
--   Option A（対象が昇格前に subscriptions 行を持たなかった場合）:
--     昇格で新規 INSERT された行を削除して完全復帰する。
--     ↓ 使う場合はこのブロックのコメントを外す。
--   ------------------------------------------------------------------
--   DELETE FROM public.subscriptions s
--   USING m1_11_roster r, auth.users u
--   WHERE lower(u.email) = lower(r.email) AND s.user_id = u.id;
--   ------------------------------------------------------------------
--
--   Option B（対象が昇格前にも行を持っていた場合＝pre-image を復元）:
--     00_baseline (S3) の current_plan/current_status を見て、対象ユーザーごとに
--     UPDATE で元の値へ戻す（自動化不可＝pre-image が必要）。以下は free へ戻す雛形。
--     ↓ 使う場合はこのブロックのコメントを外し、必要に応じ値を調整する。
--   ------------------------------------------------------------------
--   UPDATE public.subscriptions s SET
--     plan = 'free', status = NULL,
--     current_period_end = NULL, cancel_at_period_end = false,
--     updated_at = now()
--   FROM m1_11_roster r, auth.users u
--   WHERE lower(u.email) = lower(r.email) AND s.user_id = u.id;
--   ------------------------------------------------------------------
--   ⛔ どちらを選ぶかは 00_baseline の pre-image で判断すること（推測で流さない）。


-- =====================================================================
-- (R4) 10 の逆（任意）: 10 で作成した法人 org を削除する。
--   ⚠ organizations の DELETE は ON DELETE CASCADE で organization_members を巻き込むため、
--     必ず R1/R2 を先に済ませ、法人 org に membership が残っていないことを確認してから。
--   既定では実行しない（コメントアウト）。空の法人 org を掃除したい場合のみ使う。
-- ------------------------------------------------------------------
-- DELETE FROM public.organizations o
-- WHERE o.is_personal = false
--   AND o.name IN (SELECT DISTINCT corp_name FROM m1_11_roster)
--   AND NOT EXISTS (
--     SELECT 1 FROM public.organization_members om WHERE om.organization_id = o.id
--   );
-- ------------------------------------------------------------------

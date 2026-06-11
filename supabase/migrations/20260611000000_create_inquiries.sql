-- ============================================================
-- お問い合わせ（LP コンタクトフォーム）テーブル
--   LP の問い合わせフォームから送信された内容を保存する。
--   送信は未認証（anon）でも可能なため、INSERT のみ anon に許可し、
--   閲覧・更新・削除は service_role に限定する。
--
-- RLS:
--   - INSERT は anon に許可（公開フォームからの投稿を受け付ける）
--   - SELECT / UPDATE / DELETE は service_role のみ
--     （管理者は service_role キー経由でのみ閲覧。anon/authenticated は
--       自分が投稿した行であっても読み出せない ＝ 個人情報の漏洩防止）
-- ============================================================

CREATE TABLE IF NOT EXISTS inquiries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name  TEXT NOT NULL,
  contact_name  TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT,
  plan_interest TEXT,
  message       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 新着順の一覧表示用インデックス
CREATE INDEX IF NOT EXISTS inquiries_created_at_idx
  ON inquiries (created_at DESC);

-- RLS 有効化
ALTER TABLE inquiries ENABLE ROW LEVEL SECURITY;

-- INSERT は anon に許可（公開フォームからの投稿）。
-- WITH CHECK (true) で全ての挿入を許可するが、列の NOT NULL 制約と
-- API 側バリデーションで内容を担保する。
DROP POLICY IF EXISTS "inquiries_insert_anon" ON inquiries;
CREATE POLICY "inquiries_insert_anon" ON inquiries
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- SELECT / UPDATE / DELETE は service_role のみ。
-- service_role は RLS をバイパスするため実質ノーオペだが、意図を明示する。
-- anon/authenticated には読み取り・更新・削除ポリシーを一切与えない。
DROP POLICY IF EXISTS "inquiries_manage_service_role" ON inquiries;
CREATE POLICY "inquiries_manage_service_role" ON inquiries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

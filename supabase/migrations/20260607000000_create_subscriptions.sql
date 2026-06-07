-- ============================================================
-- サブスクリプション（Stripe 課金）テーブル
--   1 ユーザー = 1 サブスクリプション行（user_id を主キーにする）
--   plan   : 'free' | 'light' | 'standard'
--   status : Stripe のサブスクリプション状態を正規化した文字列
--            （'active' | 'canceled' | 'past_due' など）
--
-- RLS:
--   - 本人のレコードのみ SELECT 可
--   - INSERT / UPDATE / DELETE は service_role のみ
--     （Stripe Webhook が service_role キーで更新する。
--       service_role は RLS をバイパスするため、authenticated/anon に
--       書き込みポリシーを与えないことで「本人でも書き込めない」を担保）
-- ============================================================

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id     TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  plan                   TEXT NOT NULL DEFAULT 'free'
                           CHECK (plan IN ('free', 'light', 'standard')),
  status                 TEXT,
  current_period_end     TIMESTAMPTZ,
  cancel_at_period_end   BOOLEAN NOT NULL DEFAULT false,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 検索用インデックス
-- （UNIQUE 制約でも索引は作られるが、Webhook での照合を明示するため作成）
CREATE INDEX IF NOT EXISTS subscriptions_stripe_customer_id_idx
  ON subscriptions (stripe_customer_id);
CREATE INDEX IF NOT EXISTS subscriptions_stripe_subscription_id_idx
  ON subscriptions (stripe_subscription_id);

-- RLS 有効化
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- 本人のレコードのみ SELECT 可
DROP POLICY IF EXISTS "subscriptions_select_own" ON subscriptions;
CREATE POLICY "subscriptions_select_own" ON subscriptions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- INSERT / UPDATE / DELETE は service_role のみ。
-- service_role は RLS をバイパスするため実質ノーオペだが、意図を明示する。
DROP POLICY IF EXISTS "subscriptions_write_service_role" ON subscriptions;
CREATE POLICY "subscriptions_write_service_role" ON subscriptions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

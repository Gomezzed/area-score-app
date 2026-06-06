-- ============================================================
-- サブスクリプション（Stripe 課金）テーブル
--   1 ユーザー = 1 サブスクリプション行
--   plan: 'free' | 'light' | 'standard'
--   status: 'active' | 'canceled' | 'past_due'
--
-- 注意:
--   Stripe Webhook は service_role キーでこのテーブルを更新する
--   （RLS をバイパス）。クライアントは自分の行のみ読み取り可能。
-- ============================================================

CREATE TABLE IF NOT EXISTS subscriptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id     TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  plan                   TEXT NOT NULL DEFAULT 'free',   -- 'free', 'light', 'standard'
  status                 TEXT NOT NULL DEFAULT 'active',  -- 'active', 'canceled', 'past_due'
  current_period_end     TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

-- user_id ごとに 1 行（upsert のための一意制約）
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_id_key ON subscriptions(user_id);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- ユーザーは自分のサブスクリプションのみ読み取り可能
CREATE POLICY "users read own subscription" ON subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

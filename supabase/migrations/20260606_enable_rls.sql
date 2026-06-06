-- ============================================================
-- Row Level Security (RLS) を全テーブルに適用
-- 認証済みユーザー（authenticated ロール）のみ読み取り可能にする
--
-- 注意:
--   ダッシュボードは proxy.ts により未認証アクセスを /login へ
--   リダイレクトするため、データ読み取りは常に authenticated ロールで行われる。
--   本マイグレーションは Supabase CLI / ダッシュボードから明示的に適用すること。
-- ============================================================

-- Enable RLS
ALTER TABLE prefectures ENABLE ROW LEVEL SECURITY;
ALTER TABLE municipalities ENABLE ROW LEVEL SECURITY;
ALTER TABLE population_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE real_estate_transactions ENABLE ROW LEVEL SECURITY;

-- Public read for authenticated users only
CREATE POLICY "authenticated read prefectures" ON prefectures
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read municipalities" ON municipalities
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read population_stats" ON population_stats
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read real_estate_transactions" ON real_estate_transactions
  FOR SELECT TO authenticated USING (true);

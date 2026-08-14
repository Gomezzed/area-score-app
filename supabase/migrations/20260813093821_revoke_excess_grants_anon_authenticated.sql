-- Migration 2b-1: 過剰GRANTの剥奪(D51: 対応するRLSポリシーが存在しない権限のみ)
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon;
GRANT  INSERT ON public.inquiries TO anon;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM authenticated;
GRANT  INSERT, UPDATE, DELETE ON public.user_integrations  TO authenticated;
GRANT  INSERT, UPDATE, DELETE ON public.customer_lists     TO authenticated;
GRANT  INSERT, UPDATE, DELETE ON public.customer_list_rows TO authenticated;
REVOKE ALL ON public.v_mansion_with_trade_count FROM anon, authenticated;

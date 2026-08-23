-- =====================================================================
-- scripts/sql/10_org_setup.sql  （M1-11 / Platinum 昇格＋法人 org 編成）
--
-- 目的: 対応表に現れる法人ごとに organizations(is_personal=false) を作成する。
--
-- 実行順: 00 の後、20 の前。
-- 想定影響行数: 対応表の distinct 法人数（既存分は作らないので 0〜法人数）。
--
-- 冪等性: organizations.name に一意制約は無い（実測）ため、
--         INSERT ... SELECT ... WHERE NOT EXISTS（name 一致かつ is_personal=false）で
--         二重作成を防ぐ。2 回流しても結果は変わらない。
--
-- 実行者: PM が Supabase コネクタ（service_role 文脈）で実行。
-- 注意:
--   - is_personal=false で判定するため、個人 org（email ローカル部名）とは衝突しない。
--   - ⛔ 破壊的操作なし。organizations の DELETE/UPDATE は行わない。
-- =====================================================================

-- ─── 対応表（唯一の正・★PM がここだけ差し替える）─────────────────────────
CREATE TEMP TABLE IF NOT EXISTS m1_11_roster (email text, corp_name text);
TRUNCATE m1_11_roster;
INSERT INTO m1_11_roster (email, corp_name) VALUES
  ('tencho1@example.com', 'サンプル不動産株式会社'),
  ('tencho2@example.com', 'サンプル不動産株式会社');
  -- ここに残り32行を追加（合計34行）
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

-- 法人 org を作成（既存＝name 一致 & is_personal=false があれば作らない）。
INSERT INTO public.organizations (name, is_personal)
SELECT DISTINCT r.corp_name, false
FROM m1_11_roster r
WHERE NOT EXISTS (
  SELECT 1 FROM public.organizations o
  WHERE o.name = r.corp_name AND o.is_personal = false
);

COMMIT;

-- 確認: 対応表の全法人が is_personal=false で1件ずつ存在すること。
-- === 法人 org の作成後状態（各 corp_name が 1 件であること） ===
SELECT r.corp_name,
       (SELECT count(*) FROM public.organizations o
        WHERE o.name = r.corp_name AND o.is_personal = false) AS corp_org_count
FROM (SELECT DISTINCT corp_name FROM m1_11_roster) r
ORDER BY r.corp_name;

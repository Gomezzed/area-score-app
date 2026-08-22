-- =====================================================================
-- scripts/sql/20_members.sql  （M1-11 / Platinum 昇格＋法人 org 編成）
--
-- 目的: 対象ユーザーを法人 org へ所属させる（organization_members に追加）。
--
-- 実行順: 10 の後、25 の前。
--   ★ 25（個人 membership 削除）より必ず先に流すこと。法人 membership を
--     付ける前に個人を外すと「所属 org ゼロ窓」が生じ default_org_id() が null に
--     なるため（add-before-remove の順序が安全）。
--
-- 想定影響行数: 実在ユーザー数（最大 34）。既に所属済みは ON CONFLICT で 0。
-- 冪等性: PK=(organization_id,user_id) に対し ON CONFLICT DO NOTHING。
--
-- 実行者: PM が Supabase コネクタ（service_role 文脈）で実行。
-- 注意:
--   - role は既存慣習に合わせ 'owner'（RLS は role 非依存。調整可）。
--   - auth.users に存在しないメールは JOIN で除外＝昇格されない（40 で欠落として検出）。
--   - ⛔ 破壊的操作なし（追加のみ）。
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

-- 対象ユーザーを法人 org（is_personal=false・name 一致）へ owner として追加。
INSERT INTO public.organization_members (organization_id, user_id, role)
SELECT o.id, u.id, 'owner'
FROM m1_11_roster r
JOIN auth.users u          ON lower(u.email) = lower(r.email)
JOIN public.organizations o ON o.name = r.corp_name AND o.is_personal = false
ON CONFLICT (organization_id, user_id) DO NOTHING;

COMMIT;

-- 確認: 対象ユーザーが法人 org に所属できているか（1 なら OK）。
\echo '=== 法人 org 所属の付与後状態（corp_membership=1 が期待） ==='
SELECT r.email, r.corp_name,
  (SELECT count(*) FROM public.organization_members om
     JOIN public.organizations o ON o.id = om.organization_id
     WHERE om.user_id = u.id AND o.name = r.corp_name AND NOT o.is_personal) AS corp_membership
FROM m1_11_roster r
JOIN auth.users u ON lower(u.email) = lower(r.email)
ORDER BY r.corp_name, r.email;

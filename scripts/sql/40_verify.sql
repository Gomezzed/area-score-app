-- =====================================================================
-- scripts/sql/40_verify.sql  （M1-11 / 適用後の検証）
--
-- 目的: 10〜30 適用後の結果を検証する（副作用なし・SELECT のみ）。
--       裁定2の追加指示①〜④を出力する。
--
-- 実行順: 30 の後（最後）。
-- 想定影響行数: 0（読み取り専用）。
-- 実行者: PM が Supabase コネクタ（service_role 文脈）で実行。
--
-- 合格基準:
--   (V1) 欠落メール一覧が空（対応表の全員が auth.users に存在）
--   (V2) platinum_ok = 実在ユーザー数（＝34 を想定）／ NG 一覧が空
--   (V3) 法人 org の members 数が想定どおり
--   (V4) 対象34名の個人 org membership 残数 = 0
-- =====================================================================

-- ─── 対応表（唯一の正・★PM がここだけ差し替える）─────────────────────────
CREATE TEMP TABLE IF NOT EXISTS m1_11_roster (email text, corp_name text);
TRUNCATE m1_11_roster;
INSERT INTO m1_11_roster (email, corp_name) VALUES
  ('tencho1@example.com', 'サンプル不動産株式会社'),
  ('tencho2@example.com', 'サンプル不動産株式会社');
  -- ここに残り32行を追加（合計34行）
-- ─────────────────────────────────────────────────────────────────────

\echo '=== (V1) ★対応表メールのうち auth.users に存在しないもの（空が合格） ==='
SELECT r.email, r.corp_name
FROM m1_11_roster r
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users u WHERE lower(u.email) = lower(r.email)
)
ORDER BY r.email;

\echo '=== (V2) プラン判定が platinum になる人数（status/plan の判定条件で数える） ==='
--   判定条件は current_user_plan() / getUserPlan と同一（status ∈ active/past_due かつ plan=platinum）。
SELECT
  (SELECT count(*) FROM m1_11_roster r
     JOIN auth.users u ON lower(u.email) = lower(r.email))                AS matched_users,
  (SELECT count(*) FROM m1_11_roster r
     JOIN auth.users u ON lower(u.email) = lower(r.email)
     JOIN public.subscriptions s ON s.user_id = u.id
     WHERE s.status IN ('active','past_due') AND s.plan = 'platinum')      AS platinum_ok;

\echo '=== (V2b) platinum 判定にならない対象ユーザー（空が合格） ==='
SELECT r.email,
       COALESCE(s.plan, '(no row)')   AS plan,
       COALESCE(s.status, '(no row)') AS status
FROM m1_11_roster r
JOIN auth.users u ON lower(u.email) = lower(r.email)
LEFT JOIN public.subscriptions s ON s.user_id = u.id
WHERE s.user_id IS NULL
   OR s.plan IS DISTINCT FROM 'platinum'
   OR s.status NOT IN ('active','past_due')
ORDER BY r.email;

\echo '=== (V3) 法人 org ごとの members 数 ==='
SELECT o.name AS corp_org, count(om.user_id) AS members
FROM public.organizations o
LEFT JOIN public.organization_members om ON om.organization_id = o.id
WHERE o.is_personal = false
  AND o.name IN (SELECT DISTINCT corp_name FROM m1_11_roster)
GROUP BY o.name
ORDER BY o.name;

\echo '=== (V4) ★対象34名の個人 org membership 残数（0 が合格） ==='
SELECT count(*) AS personal_memberships_remaining
FROM m1_11_roster r
JOIN auth.users u ON lower(u.email) = lower(r.email)
JOIN public.organization_members om ON om.user_id = u.id
JOIN public.organizations o ON o.id = om.organization_id AND o.is_personal = true;

\echo '=== (V4b) （残っている場合の内訳） ==='
SELECT r.email, o.id AS personal_org_id, o.name AS personal_org_name
FROM m1_11_roster r
JOIN auth.users u ON lower(u.email) = lower(r.email)
JOIN public.organization_members om ON om.user_id = u.id
JOIN public.organizations o ON o.id = om.organization_id AND o.is_personal = true
ORDER BY r.email;

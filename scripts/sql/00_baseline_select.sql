-- =====================================================================
-- scripts/sql/00_baseline_select.sql  （M1-11 / Platinum 昇格＋法人 org 編成）
--
-- 目的: 適用【前】の実態を数えて記録する（副作用なし・SELECT のみ）。
--       10〜30 を流す前後で差分を確認できるようにする基準値。
--
-- 実行順: 一番最初。以降 10 → 20 → 25 → 30 → 40。切り戻しは 90。
-- 想定影響行数: 0（読み取り専用。DELETE/INSERT/UPDATE を一切含まない）。
--
-- 実行者: PM が Supabase コネクタ（service_role 文脈）で実行する。
--         auth.users を参照するため RLS バイパス（service_role）前提。
-- 注意:
--   - 【重要】(S4) の「対象ユーザーの個人 org 配下 customer_lists 件数」が
--     0 でなければ 25（個人 membership 削除）で当該リストが不可視化するため、
--     適用を中止して PM に報告すること（裁定2の abort 条件）。
--   - ⛔ SQL の実行はファイル作成物のレビュー後に PM が行う。CC は実行しない。
-- =====================================================================

-- ─── 対応表（唯一の正・★PM がここだけ差し替える）─────────────────────────
--   email = 各店長のログインメール / corp_name = 所属させる法人名。
--   ★★★ 下記2行は example.com の明らかな架空サンプル。適用前に必ず実データ（34行）へ
--   ★★★ 全置換すること。法人が複数なら corp_name を行ごとに変える。
CREATE TEMP TABLE IF NOT EXISTS m1_11_roster (email text, corp_name text);
TRUNCATE m1_11_roster;
INSERT INTO m1_11_roster (email, corp_name) VALUES
  ('tencho1@example.com', 'サンプル不動産株式会社'),
  ('tencho2@example.com', 'サンプル不動産株式会社');
  -- ここに残り32行を追加（合計34行）
-- ─────────────────────────────────────────────────────────────────────

\echo '=== (S1) 全体カウント（org / members / subscriptions） ==='
SELECT
  (SELECT count(*) FROM public.organizations)                              AS org_total,
  (SELECT count(*) FROM public.organizations WHERE is_personal)            AS org_personal,
  (SELECT count(*) FROM public.organizations WHERE NOT is_personal)        AS org_corp,
  (SELECT count(*) FROM public.organization_members)                       AS members_total,
  (SELECT count(*) FROM public.subscriptions)                              AS subs_total;

\echo '=== (S1b) subscriptions プラン別内訳 ==='
SELECT plan, status, count(*) AS n
FROM public.subscriptions
GROUP BY plan, status
ORDER BY plan, status;

\echo '=== (S2) 対応表の解決状況（roster 行数 / 実在ユーザー数 / 欠落数） ==='
SELECT
  (SELECT count(*) FROM m1_11_roster)                                      AS roster_rows,
  (SELECT count(*) FROM m1_11_roster r
     JOIN auth.users u ON lower(u.email) = lower(r.email))                 AS matched_users,
  (SELECT count(*) FROM m1_11_roster r
     WHERE NOT EXISTS (SELECT 1 FROM auth.users u
                       WHERE lower(u.email) = lower(r.email)))             AS missing_users;

\echo '=== (S2b) ★auth.users に存在しない対応表メール（昇格せず一覧提示・勝手に作成しない） ==='
SELECT r.email, r.corp_name
FROM m1_11_roster r
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users u WHERE lower(u.email) = lower(r.email)
)
ORDER BY r.email;

\echo '=== (S3) 対象ユーザーの現状（現プラン / 個人org所属数 / 法人org所属数） ==='
SELECT
  r.email,
  r.corp_name,
  COALESCE(s.plan, '(no row)')                                            AS current_plan,
  COALESCE(s.status, '(no row)')                                          AS current_status,
  (SELECT count(*) FROM public.organization_members om
     JOIN public.organizations o ON o.id = om.organization_id
     WHERE om.user_id = u.id AND o.is_personal)                           AS personal_org_memberships,
  (SELECT count(*) FROM public.organization_members om
     JOIN public.organizations o ON o.id = om.organization_id
     WHERE om.user_id = u.id AND NOT o.is_personal)                       AS corp_org_memberships
FROM m1_11_roster r
JOIN auth.users u ON lower(u.email) = lower(r.email)
LEFT JOIN public.subscriptions s ON s.user_id = u.id
ORDER BY r.corp_name, r.email;

\echo '=== (S4) ★abort 条件: 対象ユーザーの個人 org 配下 customer_lists 件数（0 でなければ適用中止） ==='
SELECT count(*) AS customer_lists_under_personal_org
FROM public.customer_lists cl
WHERE cl.organization_id IN (
  SELECT om.organization_id
  FROM m1_11_roster r
  JOIN auth.users u ON lower(u.email) = lower(r.email)
  JOIN public.organization_members om ON om.user_id = u.id
  JOIN public.organizations o ON o.id = om.organization_id AND o.is_personal
);

\echo '=== (S4b) （S4 が 0 でない場合の内訳: どのリストが対象か） ==='
SELECT cl.id AS customer_list_id, cl.name, cl.organization_id
FROM public.customer_lists cl
WHERE cl.organization_id IN (
  SELECT om.organization_id
  FROM m1_11_roster r
  JOIN auth.users u ON lower(u.email) = lower(r.email)
  JOIN public.organization_members om ON om.user_id = u.id
  JOIN public.organizations o ON o.id = om.organization_id AND o.is_personal
)
ORDER BY cl.organization_id, cl.name;

\echo '=== (S5) 法人 org の存在確認（10 で作成予定。既存なら作らない） ==='
SELECT DISTINCT
  r.corp_name,
  EXISTS (SELECT 1 FROM public.organizations o
          WHERE o.name = r.corp_name AND NOT o.is_personal)               AS corp_org_exists
FROM m1_11_roster r
ORDER BY r.corp_name;

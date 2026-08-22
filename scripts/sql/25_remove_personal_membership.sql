-- =====================================================================
-- scripts/sql/25_remove_personal_membership.sql  （M1-11 / 法人 org 編成）
--
-- 目的: 対象34名を「法人 org のみ」に所属させるため、個人 org の
--       organization_members 行だけを削除する（裁定2）。
--       これにより default_org_id() が法人 org を返し、以後の新規 customer_lists が
--       法人 org に入る＝D124 の共有が成立する。
--
-- 実行順: 20 の後、30 の前。★必ず 20（法人所属付与）の後に流すこと。
-- 想定影響行数: 実在ユーザーのうち個人 membership を持つ数（最大 34）。再実行時は 0。
-- 冪等性: 既に個人 membership が無ければ DELETE は 0 行。
--
-- 【⛔ 破壊的 DELETE ／ PM が例外として1つだけ承認した操作】
--   承認条件（裁定2）を全て満たす構成:
--   ① 直前に削除対象を SELECT で提示（(D1)）
--   ② DELETE は RETURNING organization_id, user_id, role（(D2)。90_rollback へ貼る材料）
--   ③ 90_rollback.sql に role を復元する逆 INSERT を用意（別ファイル）
--   ④ organizations の行自体は消さない（membership のみ削除）
--   ⑤ 既存ユーザー（対応表に無い user）は絶対に対象にしない
--      → DELETE の WHERE で m1_11_roster への結合を必須にしている
--   追加の安全弁: 「法人 org に既に所属している」ユーザーのみ削除（stranding 防止）。
--
-- 実行者: PM が Supabase コネクタ（service_role 文脈）で実行。
-- =====================================================================

-- ─── 対応表（唯一の正・★PM がここだけ差し替える）─────────────────────────
CREATE TEMP TABLE IF NOT EXISTS m1_11_roster (email text, corp_name text);
TRUNCATE m1_11_roster;
INSERT INTO m1_11_roster (email, corp_name) VALUES
  ('tencho1@example.com', 'サンプル不動産株式会社'),
  ('tencho2@example.com', 'サンプル不動産株式会社');
  -- ここに残り32行を追加（合計34行）
-- ─────────────────────────────────────────────────────────────────────

-- (D1) ① 削除対象を先に提示（副作用なし）。この一覧が想定どおりか PM が確認してから DELETE。
\echo '=== (D1) 削除対象の個人 org membership（削除前プレビュー） ==='
SELECT o.id AS organization_id, u.id AS user_id, om.role,
       r.email, o.name AS personal_org_name
FROM m1_11_roster r
JOIN auth.users u           ON lower(u.email) = lower(r.email)
JOIN public.organization_members om ON om.user_id = u.id
JOIN public.organizations o ON o.id = om.organization_id AND o.is_personal = true
-- 安全弁: 法人 org に既に所属している人のみ（20 未実行なら 0 件になり、削除もされない）
WHERE EXISTS (
  SELECT 1
  FROM public.organization_members omc
  JOIN public.organizations oc ON oc.id = omc.organization_id
  WHERE omc.user_id = u.id AND oc.is_personal = false AND oc.name = r.corp_name
)
ORDER BY r.email;

-- (D2) ② 実削除。対応表結合を必須にし（⑤）、個人 org の membership のみ（④ organizations は消さない）、
--        法人所属済みの人だけ（stranding 防止）。RETURNING で削除行を必ず出力する。
BEGIN;

DELETE FROM public.organization_members om
USING m1_11_roster r,
      auth.users u,
      public.organizations o
WHERE lower(u.email) = lower(r.email)      -- ⑤ 対応表→user の必須結合（既存ユーザーを除外）
  AND om.user_id = u.id
  AND o.id = om.organization_id
  AND o.is_personal = true                  -- 個人 org の membership のみ
  AND EXISTS (                              -- 安全弁: 法人 org に既に所属している人のみ
    SELECT 1
    FROM public.organization_members omc
    JOIN public.organizations oc ON oc.id = omc.organization_id
    WHERE omc.user_id = u.id AND oc.is_personal = false AND oc.name = r.corp_name
  )
RETURNING om.organization_id, om.user_id, om.role;

COMMIT;

-- ★上の RETURNING が出力した (organization_id, user_id, role) を控え、
--   90_rollback.sql の (R1) VALUES ブロックへ貼ること（個人 org 復元の唯一の材料）。

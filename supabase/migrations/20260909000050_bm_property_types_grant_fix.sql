-- =====================================================================
-- 20260909000050_bm_property_types_grant_fix.sql
-- 購入希望マッチ（BM）c00: public.property_types の authenticated 権限を
--   「SELECT のみ」に締め直す追認 migration。
--
-- 【本番には 2026/9/9 に PM が適用済み】
--   本番 DB では既に同等の SQL が実行されている。本ファイルは
--   migration ファイル群と実 DB の状態を一致させるための追認（後追い記録）であり、
--   新たな変更を持ち込むものではない。
--
-- 【冪等】REVOKE ALL → GRANT SELECT の 2 文のみ。何度実行しても最終状態は同じ
--   （authenticated = SELECT のみ）。適用済みの本番に再実行しても無害。
--
-- 経緯:
--   20260908000100 は `REVOKE ALL ON public.property_types FROM PUBLIC, anon;` の後に
--   `GRANT SELECT ... TO authenticated;` を置いていたが、authenticated に対しては
--   REVOKE を掛けていなかったため、テーブル作成時に既定で付与された
--   INSERT/UPDATE/DELETE 等が authenticated に残る状態だった。
--   RLS（property_types_select = SELECT のみ）で実害は塞がれているが、
--   「GRANT は SELECT のみ」という子テーブル群と同型の原則に揃えるため明示的に剥がす。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う（R7・D57）。
--   ※ supabase db push は恒久禁止。
-- =====================================================================

BEGIN;

REVOKE ALL ON public.property_types FROM authenticated;
GRANT SELECT ON public.property_types TO authenticated;

COMMIT;


-- =====================================================================
-- ロールバック: 不要。
--   本 migration は権限を締める方向のみで、テーブル・列・データ・RLS を一切変更しない。
--   仮に元の（緩い）状態へ戻す必要が生じても、それは既定 GRANT の復元に過ぎず、
--   意図的に戻すべき状態ではないため切り戻し SQL は用意しない。
-- =====================================================================


-- =====================================================================
-- 適用後の確認 SQL（PM が実行）:
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_schema='public' AND table_name='property_types' ORDER BY 1,2;
--   -- 期待: authenticated=SELECT の 1 行のみ。anon は 1 件も出ない。
--
--   SELECT policyname, cmd FROM pg_policies
--   WHERE schemaname='public' AND tablename='property_types';
--   -- 期待: property_types_select / SELECT の 1 本（不変）。
-- =====================================================================

-- =====================================================================
-- 外部サービス連携トークン（Google Drive/Sheets 等）の保管テーブル
-- ---------------------------------------------------------------------
-- 用途: 「Sheets に出力」機能で使う Google OAuth の refresh_token を、
--        ユーザー単位で暗号化保存する（AES-256-GCM・アプリ層で暗号化）。
-- 原則: refresh_token は平文で保存しない（refresh_token_enc に暗号文のみ）。
-- RLS : authenticated は自分の行のみ操作可（多層防御）。
--        アプリはユーザースコープのサーバークライアント経由で読み書きする。
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.user_integrations (
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL CHECK (provider = 'google'),
  refresh_token_enc TEXT NOT NULL,
  scope             TEXT NOT NULL,
  connected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);

ALTER TABLE public.user_integrations ENABLE ROW LEVEL SECURITY;

-- authenticated は auth.uid() = user_id の行のみ SELECT/INSERT/UPDATE/DELETE 可。
DROP POLICY IF EXISTS "ui_select_own" ON public.user_integrations;
CREATE POLICY "ui_select_own"
  ON public.user_integrations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "ui_insert_own" ON public.user_integrations;
CREATE POLICY "ui_insert_own"
  ON public.user_integrations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "ui_update_own" ON public.user_integrations;
CREATE POLICY "ui_update_own"
  ON public.user_integrations FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "ui_delete_own" ON public.user_integrations;
CREATE POLICY "ui_delete_own"
  ON public.user_integrations FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

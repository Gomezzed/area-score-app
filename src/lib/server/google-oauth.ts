// ============================================================
// Google OAuth（Sheets 出力連携）サーバーヘルパー。
//   スコープは drive.file のみ（アプリが作成したファイルにのみアクセス可・非センシティブ）。
//   Supabase Auth の Google ログインとは完全に独立した接続フロー。
//   通信はすべて fetch。新規 npm 依存は追加しない。サーバー専用。
// ============================================================

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

// アプリが作成したファイルのみアクセス可能な非センシティブスコープ。
export const GOOGLE_DRIVE_FILE_SCOPE =
  'https://www.googleapis.com/auth/drive.file'

interface GoogleOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth の環境変数が未設定です')
  }
  return { clientId, clientSecret, redirectUri }
}

// 認可 URL を構築（access_type=offline + prompt=consent で refresh_token を確実に得る）。
export function buildGoogleAuthorizeUrl(state: string): string {
  const { clientId, redirectUri } = getGoogleOAuthConfig()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_DRIVE_FILE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

export interface GoogleTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}

// refresh_token が無効/失効している場合に投げる（呼び出し側で行削除→再接続導線）。
export class InvalidGrantError extends Error {
  constructor(message = 'invalid_grant') {
    super(message)
    this.name = 'InvalidGrantError'
  }
}

// 認可コード → トークン交換（refresh_token を含む）。
export async function exchangeCodeForTokens(
  code: string,
): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret, redirectUri } = getGoogleOAuthConfig()
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  return (await res.json()) as GoogleTokenResponse
}

// refresh_token → access_token。invalid_grant 時は InvalidGrantError を投げる。
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = getGoogleOAuthConfig()
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  })
  const json = (await res.json()) as GoogleTokenResponse
  if (!res.ok || !json.access_token) {
    if (json.error === 'invalid_grant') {
      throw new InvalidGrantError(json.error_description ?? 'invalid_grant')
    }
    throw new Error(`access_token の取得に失敗しました: ${json.error ?? res.status}`)
  }
  return json.access_token
}

// トークンの失効（ベストエフォート。失敗しても例外は投げない）。
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(GOOGLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    })
  } catch {
    // ベストエフォート: 失効に失敗しても DB 側の行削除は済んでいるため無視。
  }
}

import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { safeNextPath } from '@/lib/safe-next-path'

/**
 * パスワード再設定リンク（token_hash 方式）を受けてセッションを確立する。
 *
 * O22-b: 既存の PKCE 経路（/auth/callback の exchangeCodeForSession）は
 * code verifier を「申請した端末」の storage に要求するため、
 * 「PCで申請 → スマホでリンクを開く」で verifier が無く失敗する。
 * token_hash 方式はサーバ側 verifyOtp で検証しCookieへセッションを格納するため
 * verifier に依存せず、クロスデバイスで成立する。
 *
 * フロー:
 *   1. 再設定メールのリンク → `${origin}/auth/confirm?token_hash=...&type=recovery&next=...`
 *      （メールテンプレートの差し替えは PO 作業。CC は本ルートのみ用意する）
 *   2. verifyOtp({ type: 'recovery', token_hash }) でセッション確立（Cookie セット）
 *   3. safeNextPath で安全化した遷移先（既定 /auth/update-password）へリダイレクト
 *
 * PKCE 既存経路（/auth/callback）は削除しない。両経路が並存する。
 *
 * セキュリティ:
 *   - reason には token_hash・メールアドレス・生エラーを一切含めない。
 *   - token_hash はログに出力しない。
 *   - 遷移先は必ず safeNextPath を通す（オープンリダイレクト防止・D67 と同等）。
 */

// 成功時の既定遷移先。callback は safeNextPath の fallback を '/dashboard' にするが、
// recovery はパスワード更新が目的のため update-password を既定にする。
const DEFAULT_NEXT = '/auth/update-password'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  // next は外部から任意に渡せるため、必ず safeNextPath で同一オリジン内の
  // 絶対パスに限定する（`${origin}${next}` 連結によるオープンリダイレクト防止）。
  const next = safeNextPath(searchParams.get('next'), DEFAULT_NEXT)

  // verifyOtp を呼ぶ前に自前で判定できる不正はここで弾く（Supabase のエラー
  // コードに依存しない）。type は recovery のみ許可（PM 確定・範囲外の
  // email/invite/email_change は受け付けない）。
  if (!tokenHash || type !== 'recovery') {
    return redirectWithReason(origin, next, 'invalid')
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.verifyOtp({
    type: 'recovery',
    token_hash: tokenHash,
  })

  if (error) {
    // 生エラーメッセージ・token_hash はログに出さない。分類コードのみ残す。
    const reason = classifyOtpError(error)
    console.error('[Auth Confirm] verifyOtp 失敗:', reason)
    return redirectWithReason(origin, next, reason)
  }

  // 成功時のみ安全化済みの遷移先へ。
  return NextResponse.redirect(`${origin}${next}`)
}

type Reason = 'expired' | 'invalid' | 'used' | 'unknown'

/**
 * verifyOtp のエラーを画面表示用の reason に丸める（案②）。
 * 判別できるものだけ個別化し、判別不能は expired に寄せる（再送導線が最も有用）。
 *
 * used は verifyOtp のエラーコードでは「期限切れ」と確実に区別できないため、
 * ここでは推測で分類しない（PM: 無理に分類しない）。将来 Supabase 側に
 * 確実な判別コードが現れたときのみ used を返すよう拡張する。
 */
function classifyOtpError(error: { code?: string }): Reason {
  if (error.code === 'otp_expired') return 'expired'
  // 判別不能は expired へ寄せる。
  return 'expired'
}

/**
 * reason を allowlist で検証し、update-password の no-session カードへ渡す。
 * クエリはそのまま画面描画せず、遷移先ページ側で allowlist 照合してから文言化する。
 */
function redirectWithReason(origin: string, next: string, reason: Reason) {
  const url = new URL(`${origin}${next}`)
  url.searchParams.set('reason', reason)
  return NextResponse.redirect(url)
}

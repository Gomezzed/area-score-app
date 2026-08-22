/**
 * /auth/confirm（token_hash 方式・recovery）の純ロジック。
 *
 * O52（地雷㉕）対策の A 案：GET では token_hash を消費せず、確認ページの
 * ボタン押下（Server Action）ではじめて verifyOtp を呼ぶ。その際の
 *   - パラメータ検証（recovery 以外・token_hash 不在を弾く）
 *   - verifyOtp を「ちょうど1回」呼ぶ薄いラッパ
 *   - 失敗コードの画面表示用 reason への丸め
 * を Route/React 非依存の純関数に切り出し、node:test で単体検証可能にする。
 *
 * セキュリティ / 挙動は現行 route.ts を踏襲する（新仕様を足さない）:
 *   - reason には token_hash・メールアドレス・生エラーを含めない。
 *   - type は recovery のみ許可（signup/invite/email_change 等は invalid）。
 *   - 判別不能な verifyOtp 失敗は expired に寄せる（再送導線が最も有用）。
 */

export type ConfirmReason = 'expired' | 'invalid' | 'used' | 'unknown'

/**
 * confirm パラメータを検証する（現行 route.ts の `!tokenHash || type !== 'recovery'`
 * と同一判定）。recovery かつ token_hash 有りのときだけ ok。
 */
export function validateConfirmParams(
  tokenHash: string | null | undefined,
  type: string | null | undefined
): { ok: true; tokenHash: string } | { ok: false; reason: ConfirmReason } {
  if (!tokenHash || type !== 'recovery') {
    return { ok: false, reason: 'invalid' }
  }
  return { ok: true, tokenHash }
}

/**
 * verifyOtp のエラーを画面表示用の reason に丸める（現行 route.ts と同一）。
 *
 * used は verifyOtp のエラーコードでは「期限切れ」と確実に区別できないため、
 * ここでは推測で分類しない。将来 Supabase 側に確実な判別コードが現れたときのみ
 * used を返すよう拡張する。判別不能は expired に寄せる。
 */
export function classifyOtpError(error: { code?: string }): ConfirmReason {
  if (error.code === 'otp_expired') return 'expired'
  return 'expired'
}

/**
 * verifyOtp を注入して「ちょうど1回」呼ぶ薄いラッパ。
 * Supabase クライアントそのものではなく verifyOtp 関数を受け取ることで、
 * 実クライアントのオーバーロード型に依存せず、テストでも差し替え可能にする。
 *
 * @returns 成功時 null / 失敗時は表示用 reason
 */
export type VerifyOtpFn = (params: {
  type: 'recovery'
  token_hash: string
}) => Promise<{ error: { code?: string } | null }>

export async function consumeRecovery(
  verifyOtp: VerifyOtpFn,
  tokenHash: string
): Promise<ConfirmReason | null> {
  const { error } = await verifyOtp({ type: 'recovery', token_hash: tokenHash })
  if (error) return classifyOtpError(error)
  return null
}

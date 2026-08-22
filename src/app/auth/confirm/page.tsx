import { redirect } from 'next/navigation'
import Link from 'next/link'
import { KeyRound } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { safeNextPath } from '@/lib/safe-next-path'
import { Logo } from '@/components/Logo'
import { validateConfirmParams, consumeRecovery } from '@/lib/auth/confirm-recovery'

/**
 * パスワード再設定リンク（token_hash 方式・recovery）の確認ページ。
 *
 * O52（地雷㉕）対策の A 案:
 *   iOS のリンク長押しプレビュー等が GET でリンクをロードすると、旧実装
 *   （GET で即 verifyOtp）では token_hash が消費され、本タップ時に無効化した。
 *   本ページは GET では **verifyOtp を呼ばず確認カードを描画するだけ**とし、
 *   ユーザーのボタン押下（Server Action）ではじめて verifyOtp を実行する。
 *
 * フロー:
 *   1. 再設定メールのリンク → `${origin}/auth/confirm?token_hash=...&type=recovery&next=...`
 *   2. GET: token_hash/type を検証し、確認カードを表示（token_hash は hidden で保持・未消費）
 *   3. 押下: Server Action が verifyOtp({ type:'recovery', token_hash }) でセッション確立
 *      （サーバ Cookie。O22-b のクロスデバイス成立を踏襲）→ safeNextPath 済み遷移先へ
 *
 * 成功時の遷移先・失敗時のエラー表示は現行踏襲:
 *   - 既定遷移先 /auth/update-password
 *   - 失敗/不正は `?reason=<code>` を付けて遷移先へ（文言は遷移先ページが allowlist 照合）
 *
 * セキュリティ:
 *   - reason に token_hash・メールアドレス・生エラーを含めない。token_hash をログに出さない。
 *   - 遷移先は必ず safeNextPath を通す（オープンリダイレクト防止・D67 と同水準）。
 *   - type は recovery のみ許可（signup/invite/email_change 等は invalid）。
 */

// 成功時の既定遷移先。recovery はパスワード更新が目的のため update-password を既定にする。
const DEFAULT_NEXT = '/auth/update-password'

// searchParams / FormData は string | string[] | null を取り得る。先頭の文字列だけ採る。
function firstString(v: string | string[] | undefined | null): string | null {
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : null
  return typeof v === 'string' ? v : null
}

// 遷移先パスに reason を付与する（reason は固定 allowlist 値のみ・エンコード不要）。
function withReason(path: string, reason: string): string {
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}reason=${reason}`
}

/**
 * ボタン押下時にはじめて token_hash を消費する Server Action。
 * hidden 値は信用せず、safeNextPath / validateConfirmParams で必ず再検証する。
 */
async function confirmAction(formData: FormData) {
  'use server'

  // next は外部由来の hidden 値。必ず safeNextPath で同一オリジン内の絶対パスに限定する。
  const next = safeNextPath(firstString(formData.get('next') as string | null), DEFAULT_NEXT)

  const check = validateConfirmParams(
    firstString(formData.get('token_hash') as string | null),
    firstString(formData.get('type') as string | null)
  )
  if (!check.ok) {
    redirect(withReason(next, check.reason))
  }

  const supabase = await createSupabaseServerClient()
  const reason = await consumeRecovery(
    (params) => supabase.auth.verifyOtp(params),
    check.tokenHash
  )
  if (reason) {
    // 生エラー・token_hash は出さない。分類コードのみ残す。
    console.error('[Auth Confirm] verifyOtp 失敗:', reason)
    redirect(withReason(next, reason))
  }

  // 成功時のみ安全化済みの遷移先へ。
  redirect(next)
}

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const tokenHash = firstString(sp.token_hash)
  const type = firstString(sp.type)
  const next = safeNextPath(firstString(sp.next), DEFAULT_NEXT)

  // GET 時点では verifyOtp を呼ばない。パラメータが不正なら現行同様に
  // 遷移先へ ?reason=invalid で送り、no-session カードで文言化する。
  const check = validateConfirmParams(tokenHash, type)
  if (!check.ok) {
    redirect(withReason(next, check.reason))
  }

  return (
    <div className="min-h-screen bg-page-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="flex items-center justify-center mb-4">
            <Link href="/">
              <Logo size="lg" />
            </Link>
          </h1>
          <p className="text-slate-500 mt-2">パスワード再設定の確認</p>
        </div>

        <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 text-center">
          <div className="text-slate-700 text-lg font-semibold mb-2">
            パスワード再設定を続けます
          </div>
          <p className="text-slate-500 text-sm mb-6 leading-relaxed">
            下のボタンを押すと本人確認が完了し、新しいパスワードの設定に進みます。
          </p>

          <form action={confirmAction}>
            {/* token_hash はここで保持し、押下まで消費しない（未検証の GET では未消費） */}
            <input type="hidden" name="token_hash" value={check.tokenHash} />
            <input type="hidden" name="type" value="recovery" />
            <input type="hidden" name="next" value={next} />
            <button
              type="submit"
              className="w-full bg-brand-700 hover:bg-brand-500 text-white font-medium rounded-lg px-4 py-3 flex items-center justify-center gap-2 transition-colors"
            >
              <KeyRound className="w-5 h-5" />
              続ける
            </button>
          </form>

          <p className="text-center text-slate-500 text-sm mt-6">
            <Link href="/login" className="text-brand-700 hover:text-brand-500 font-medium">
              ログインへ戻る
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

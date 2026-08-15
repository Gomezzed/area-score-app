'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { KeyRound, ArrowLeft } from 'lucide-react'
import { Logo } from '@/components/Logo'

/**
 * パスワード再設定リンク（recovery）を受けて新しいパスワードを設定する画面。
 *
 * フロー:
 *   1. 再設定メールのリンク → 既存の /auth/callback が `?code=` を
 *      exchangeCodeForSession でセッション化（recovery セッション確立）
 *   2. `next=/auth/update-password` でこの画面へ遷移
 *   3. ここではセッションの有無だけを確認し、確立していれば更新を許可する
 *
 * セッションが無い（リンク未経由・期限切れ・無効）場合は、白画面や
 * 無言の失敗にせず、再送を促すエラー画面を表示する。
 */

// register/page.tsx と同一のパスワードポリシー（最低6文字）
const MIN_PASSWORD_LENGTH = 6

type Phase = 'checking' | 'ready' | 'no-session' | 'done'

export default function UpdatePasswordPage() {
  const [phase, setPhase] = useState<Phase>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // マウント時に recovery セッションの有無を確認する。
  useEffect(() => {
    let active = true

    async function check() {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!active) return
      setPhase(session ? 'ready' : 'no-session')
    }

    check()

    // PKCE 経由でも取りこぼしを防ぐため、recovery イベントも監視する。
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (session && (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN')) {
        setPhase('ready')
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setError(null)

    if (password !== confirm) {
      setError('パスワードが一致しません')
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`パスワードは${MIN_PASSWORD_LENGTH}文字以上で入力してください`)
      return
    }

    setLoading(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError(`更新エラー: ${updateError.message}`)
        setLoading(false)
        return
      }
      setPhase('done')
    } catch (err) {
      setError(`予期しないエラーが発生しました: ${String(err)}`)
      setLoading(false)
    }
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
          <p className="text-slate-500 mt-2">新しいパスワードの設定</p>
        </div>

        {phase === 'checking' && (
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 text-center">
            <div className="flex items-center justify-center gap-3 text-slate-500 text-sm">
              <span className="w-5 h-5 border-2 border-brand-700 border-t-transparent rounded-full animate-spin" />
              確認中...
            </div>
          </div>
        )}

        {phase === 'no-session' && (
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 text-center">
            <div className="text-red-700 text-lg font-semibold mb-2">
              リンクが無効か、期限切れです
            </div>
            <p className="text-slate-500 text-sm mb-6 leading-relaxed">
              パスワード再設定用のリンクが無効になっているか、有効期限が
              切れている可能性があります。お手数ですが、もう一度再設定用の
              メールを送信してください。
            </p>
            <Link
              href="/auth/forgot-password"
              className="inline-flex items-center justify-center gap-2 w-full bg-brand-700 hover:bg-brand-500 text-white font-medium rounded-lg px-4 py-3 transition-colors"
            >
              再設定メールを再送する
            </Link>
            <p className="text-center text-slate-500 text-sm mt-6">
              <Link href="/login" className="text-brand-700 hover:text-brand-500 font-medium">
                ログインへ戻る
              </Link>
            </p>
          </div>
        )}

        {phase === 'done' && (
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 text-center">
            <div className="text-emerald-600 text-lg font-semibold mb-2">
              パスワードを更新しました
            </div>
            <p className="text-slate-500 text-sm mb-6 leading-relaxed">
              新しいパスワードで再設定が完了しました。そのままダッシュボードへ
              お進みいただけます。
            </p>
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center gap-2 w-full bg-brand-700 hover:bg-brand-500 text-white font-medium rounded-lg px-4 py-3 transition-colors"
            >
              ダッシュボードへ進む
            </Link>
          </div>
        )}

        {phase === 'ready' && (
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200"
          >
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 mb-6 text-sm whitespace-pre-wrap break-all">
                {error}
              </div>
            )}

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  新しいパスワード
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full bg-slate-50 border border-slate-200 text-slate-700 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-brand-700 focus:border-transparent placeholder-slate-400"
                  placeholder="6文字以上"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  新しいパスワード（確認）
                </label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  className="w-full bg-slate-50 border border-slate-200 text-slate-700 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-brand-700 focus:border-transparent placeholder-slate-400"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-6 bg-brand-700 hover:bg-brand-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium rounded-lg px-4 py-3 flex items-center justify-center gap-2 transition-colors"
            >
              {loading ? (
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <KeyRound className="w-5 h-5" />
              )}
              {loading ? '更新中...' : 'パスワードを更新'}
            </button>

            <p className="text-center text-slate-500 text-sm mt-6">
              <Link
                href="/login"
                className="inline-flex items-center gap-1 text-brand-700 hover:text-brand-500 font-medium"
              >
                <ArrowLeft className="w-4 h-4" />
                ログインへ戻る
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}

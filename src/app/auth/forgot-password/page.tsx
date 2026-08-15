'use client'

import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Mail, ArrowLeft } from 'lucide-react'
import { Logo } from '@/components/Logo'

/**
 * パスワード再設定メールの送信フォーム。
 *
 * セキュリティ上、メールアドレスの登録有無を絶対に出し分けない
 * （列挙攻撃防止）。送信処理の成功・失敗にかかわらず、常に同一の
 * 完了メッセージを表示する。
 *
 * 再設定リンクは PKCE フローのため `?code=` 付きで戻ってくる。
 * これを交換する既存の /auth/callback を経由し、`next` で更新画面へ誘導する。
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setLoading(true)

    // 登録の有無で分岐しないため、レスポンスのエラー内容は画面に反映しない。
    // 送信リンクは /auth/callback でコード交換し、更新画面 /auth/update-password へ。
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
      '/auth/update-password'
    )}`

    try {
      await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    } catch {
      // ネットワーク等の例外も、列挙を避けるため個別のエラー表示はしない。
    } finally {
      // 成功・失敗を問わず同一の完了表示にする（前提: メール列挙を許さない）。
      setSent(true)
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
          <p className="text-slate-500 mt-2">パスワードの再設定</p>
        </div>

        {sent ? (
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 text-center">
            <div className="text-emerald-600 text-lg font-semibold mb-2">
              メールを送信しました
            </div>
            <p className="text-slate-500 text-sm mb-6 leading-relaxed">
              入力されたメールアドレスが登録済みの場合、パスワード再設定用の
              リンクを記載したメールをお送りしました。メール内のリンクから
              再設定を完了してください。
            </p>
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 w-full bg-brand-700 hover:bg-brand-500 text-white font-medium rounded-lg px-4 py-3 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              ログインへ戻る
            </Link>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200"
          >
            <p className="text-slate-500 text-sm mb-6 leading-relaxed">
              ご登録のメールアドレスを入力してください。パスワード再設定用の
              リンクをメールでお送りします。
            </p>

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  メールアドレス
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full bg-slate-50 border border-slate-200 text-slate-700 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-brand-700 focus:border-transparent placeholder-slate-400"
                  placeholder="you@example.com"
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
                <Mail className="w-5 h-5" />
              )}
              {loading ? '送信中...' : '再設定リンクを送信'}
            </button>

            <p className="text-center text-slate-500 text-sm mt-6">
              <Link href="/login" className="text-brand-700 hover:text-brand-500 font-medium">
                ログインへ戻る
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}

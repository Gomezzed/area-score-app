'use client'

import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { LogIn } from 'lucide-react'
import { Logo } from '@/components/Logo'

// ログイン後の遷移先を ?redirect= から取得する。
//   オープンリダイレクト防止のため内部パス（'/' 始まり・'//' や '/\' は除外）のみ許可。
//   未指定 / 不正値は /dashboard にフォールバック。
function safeRedirectTarget(): string {
  if (typeof window === 'undefined') return '/dashboard'
  const r = new URLSearchParams(window.location.search).get('redirect')
  if (r && r.startsWith('/') && r[1] !== '/' && r[1] !== '\\') return r
  return '/dashboard'
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGoogleLogin() {
    setError(null)
    setGoogleLoading(true)
    // OAuth はコールバック経由のため、戻り先を ?next= で /auth/callback に引き継ぐ
    // （callback は next を見て最終遷移先へリダイレクトする）。
    const target = safeRedirectTarget()
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(target)}`,
      },
    })
    if (authError) {
      setError(`Googleログインエラー: ${authError.message}`)
      setGoogleLoading(false)
    }
    // 成功時は Google へリダイレクトされるため以降の処理は不要
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    console.log('[Login] signInWithPassword 開始:', email)

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      console.log('[Login] レスポンス:', { data, error: authError })

      if (authError) {
        console.error('[Login] 認証エラー:', authError)
        setError(`認証エラー: ${authError.message}`)
        setLoading(false)
        return
      }

      if (!data.session) {
        console.error('[Login] セッションなし:', data)
        setError('ログインに失敗しました（セッションが取得できません）')
        setLoading(false)
        return
      }

      const target = safeRedirectTarget()
      console.log('[Login] 認証成功、遷移先:', target)
      // router.push だとプロキシがクッキーを認識する前にリクエストが来るため
      // フルページリロードで遷移してセッションクッキーを確実に送信する。
      // ?redirect= があればそこへ（例: /pricing から来たユーザーを料金ページへ戻す）。
      window.location.href = target
    } catch (err) {
      console.error('[Login] 予期しないエラー:', err)
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
            <Logo size="lg" />
          </h1>
          <p className="text-slate-500 mt-2">ダッシュボードにログイン</p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 mb-6 text-sm whitespace-pre-wrap break-all">
              {error}
            </div>
          )}

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

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                パスワード
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
              <LogIn className="w-5 h-5" />
            )}
            {loading ? 'ログイン中...' : 'ログイン'}
          </button>

          {/* 区切り */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs text-slate-500">または</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          {/* Google ログイン */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={googleLoading}
            className="w-full bg-white hover:bg-brand-100 border border-[#C7D6E4] disabled:opacity-70 disabled:cursor-not-allowed text-brand-700 font-medium rounded-lg px-4 py-3 flex items-center justify-center gap-2 transition-colors"
          >
            {googleLoading ? (
              <span className="w-5 h-5 border-2 border-brand-700 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
              </svg>
            )}
            Googleでログイン
          </button>

          {/* アカウント作成リンク */}
          <p className="text-center text-slate-500 text-sm mt-6">
            アカウントをお持ちでないですか？{' '}
            <Link href="/register" className="text-brand-700 hover:text-brand-500 font-medium">
              アカウント作成
            </Link>
          </p>
        </form>

        {/* デバッグ用ヒント */}
        <p className="text-center text-slate-400 text-xs mt-4">
          エラーの詳細はブラウザのコンソール(F12)で確認できます
        </p>
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { MapPin, LogIn } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGoogleLogin() {
    setError(null)
    setGoogleLoading(true)
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
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

      console.log('[Login] 認証成功、ダッシュボードへ遷移')
      // router.push だとプロキシがクッキーを認識する前にリクエストが来るため
      // フルページリロードで遷移してセッションクッキーを確実に送信する
      window.location.href = '/dashboard'
    } catch (err) {
      console.error('[Login] 予期しないエラー:', err)
      setError(`予期しないエラーが発生しました: ${String(err)}`)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4">
            <MapPin className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">エリアスコア分析</h1>
          <p className="text-slate-400 mt-2">ダッシュボードにログイン</p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="bg-slate-800 rounded-2xl p-8 shadow-2xl border border-slate-700">
          {error && (
            <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-lg p-3 mb-6 text-sm whitespace-pre-wrap break-all">
              {error}
            </div>
          )}

          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                メールアドレス
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-slate-700 border border-slate-600 text-white rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-slate-400"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                パスワード
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-slate-700 border border-slate-600 text-white rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-slate-400"
                placeholder="••••••••"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-6 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-medium rounded-lg px-4 py-3 flex items-center justify-center gap-2 transition-colors"
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
            <div className="flex-1 h-px bg-slate-700" />
            <span className="text-xs text-slate-500">または</span>
            <div className="flex-1 h-px bg-slate-700" />
          </div>

          {/* Google ログイン */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={googleLoading}
            className="w-full bg-white hover:bg-slate-100 disabled:opacity-70 disabled:cursor-not-allowed text-slate-800 font-medium rounded-lg px-4 py-3 flex items-center justify-center gap-2 transition-colors"
          >
            {googleLoading ? (
              <span className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
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
          <p className="text-center text-slate-400 text-sm mt-6">
            アカウントをお持ちでないですか？{' '}
            <Link href="/register" className="text-blue-400 hover:text-blue-300 font-medium">
              アカウント作成
            </Link>
          </p>
        </form>

        {/* デバッグ用ヒント */}
        <p className="text-center text-slate-600 text-xs mt-4">
          エラーの詳細はブラウザのコンソール(F12)で確認できます
        </p>
      </div>
    </div>
  )
}

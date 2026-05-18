'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { MapPin, LogIn } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        </form>

        {/* デバッグ用ヒント */}
        <p className="text-center text-slate-600 text-xs mt-4">
          エラーの詳細はブラウザのコンソール(F12)で確認できます
        </p>
      </div>
    </div>
  )
}

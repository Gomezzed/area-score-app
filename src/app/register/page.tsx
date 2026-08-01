'use client'

import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { UserPlus } from 'lucide-react'
import { Logo } from '@/components/Logo'

export default function RegisterPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password !== confirm) {
      setError('パスワードが一致しません')
      return
    }
    if (password.length < 6) {
      setError('パスワードは6文字以上で入力してください')
      return
    }

    setLoading(true)
    try {
      const { error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name },
          emailRedirectTo:
            typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : undefined,
        },
      })

      if (authError) {
        setError(`登録エラー: ${authError.message}`)
        setLoading(false)
        return
      }

      setDone(true)
    } catch (err) {
      setError(`予期しないエラーが発生しました: ${String(err)}`)
    } finally {
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
          <p className="text-slate-500 mt-2">アカウント作成</p>
        </div>

        {done ? (
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 text-center">
            <div className="text-emerald-600 text-lg font-semibold mb-2">
              確認メールを送信しました
            </div>
            <p className="text-slate-500 text-sm mb-6">
              メール内のリンクをクリックして登録を完了してください。
            </p>
            <Link
              href="/login"
              className="inline-block w-full bg-brand-700 hover:bg-brand-500 text-white font-medium rounded-lg px-4 py-3 transition-colors"
            >
              ログインへ戻る
            </Link>
          </div>
        ) : (
          <form
            onSubmit={handleRegister}
            className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200"
          >
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 mb-6 text-sm whitespace-pre-wrap break-all">
                {error}
              </div>
            )}

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">お名前</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full bg-slate-50 border border-slate-200 text-slate-700 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-brand-700 focus:border-transparent placeholder-slate-400"
                  placeholder="山田 太郎"
                />
              </div>
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
                <label className="block text-sm font-medium text-slate-700 mb-2">パスワード</label>
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
                  パスワード（確認）
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
                <UserPlus className="w-5 h-5" />
              )}
              {loading ? '登録中...' : 'アカウント作成'}
            </button>

            <p className="text-center text-slate-500 text-sm mt-6">
              すでにアカウントをお持ちですか？{' '}
              <Link href="/login" className="text-brand-700 hover:text-brand-500 font-medium">
                ログイン
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}

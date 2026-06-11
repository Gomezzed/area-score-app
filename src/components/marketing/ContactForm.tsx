'use client'

import { useState, type FormEvent } from 'react'
import { Send, CheckCircle2, AlertCircle } from 'lucide-react'

// ⑩ Contact（ダーク）— お問い合わせフォーム
//   会社名 / 担当者名 / メール / 電話(任意) / 興味のあるプラン(select) / メッセージ / 同意チェック
//   honeypot（website）でスパム対策。POST /api/inquiries。

const PLAN_OPTIONS = [
  { value: '', label: '選択してください（任意）' },
  { value: 'free', label: 'Free' },
  { value: 'starter', label: 'Starter' },
  { value: 'standard', label: 'Standard' },
  { value: 'platinum', label: 'Platinum' },
  { value: 'undecided', label: '未定・相談したい' },
]

type Status = 'idle' | 'submitting' | 'success' | 'error'

export function ContactForm() {
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('submitting')
    setErrorMsg('')

    const form = e.currentTarget
    const data = Object.fromEntries(new FormData(form).entries())

    try {
      const res = await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? '送信に失敗しました。時間をおいて再度お試しください。')
      }
      setStatus('success')
      form.reset()
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : '送信に失敗しました。')
    }
  }

  const inputClass =
    'w-full rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 px-4 py-3 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors'
  const labelClass = 'block text-sm font-medium text-slate-200 mb-1.5'

  return (
    <section id="contact" className="bg-slate-900 text-white scroll-mt-16">
      <div className="max-w-2xl mx-auto px-4 py-20 sm:py-24">
        <div className="text-center mb-10">
          <p className="text-blue-400 font-semibold text-sm mb-3">お問い合わせ</p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
            無料デモ・クローズドβのお申し込み
          </h2>
          <p className="text-slate-400 mt-4 leading-relaxed">
            導入のご相談・デモのご希望は、こちらのフォームからお気軽にどうぞ。
            担当より折り返しご連絡します。
          </p>
        </div>

        {status === 'success' ? (
          <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-8 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
            <h3 className="text-lg font-bold mb-2">送信ありがとうございました</h3>
            <p className="text-slate-300 text-sm">
              内容を確認のうえ、担当より折り返しご連絡いたします。
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {/* honeypot: 通常ユーザーには見えない。bot が入力すると API 側で弾く。 */}
            <div className="absolute -left-[9999px]" aria-hidden="true">
              <label htmlFor="website">Website</label>
              <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
            </div>

            <div className="grid sm:grid-cols-2 gap-5">
              <div>
                <label htmlFor="company_name" className={labelClass}>
                  会社名 <span className="text-blue-400">*</span>
                </label>
                <input id="company_name" name="company_name" type="text" required className={inputClass} placeholder="株式会社エリアスコア" />
              </div>
              <div>
                <label htmlFor="contact_name" className={labelClass}>
                  担当者名 <span className="text-blue-400">*</span>
                </label>
                <input id="contact_name" name="contact_name" type="text" required className={inputClass} placeholder="山田 太郎" />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-5">
              <div>
                <label htmlFor="email" className={labelClass}>
                  メールアドレス <span className="text-blue-400">*</span>
                </label>
                <input id="email" name="email" type="email" required className={inputClass} placeholder="taro@example.com" />
              </div>
              <div>
                <label htmlFor="phone" className={labelClass}>
                  電話番号 <span className="text-slate-500 text-xs">（任意）</span>
                </label>
                <input id="phone" name="phone" type="tel" className={inputClass} placeholder="03-1234-5678" />
              </div>
            </div>

            <div>
              <label htmlFor="plan_interest" className={labelClass}>
                興味のあるプラン <span className="text-slate-500 text-xs">（任意）</span>
              </label>
              <select id="plan_interest" name="plan_interest" className={inputClass} defaultValue="">
                {PLAN_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value} className="bg-slate-800">
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="message" className={labelClass}>
                メッセージ <span className="text-slate-500 text-xs">（任意）</span>
              </label>
              <textarea id="message" name="message" rows={4} className={inputClass} placeholder="ご相談内容やご希望をご記入ください。" />
            </div>

            <label className="flex items-start gap-3 text-sm text-slate-300 cursor-pointer">
              <input type="checkbox" name="consent" required className="mt-0.5 w-4 h-4 rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-blue-500" />
              <span>
                <a href="/legal/privacy" className="text-blue-400 hover:text-blue-300 underline">プライバシーポリシー</a>
                に同意のうえ送信します。
              </span>
            </label>

            {status === 'error' && (
              <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/40 px-4 py-3 text-sm text-red-300">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={status === 'submitting'}
              className="w-full inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-6 py-3.5 transition-colors"
            >
              {status === 'submitting' ? '送信中…' : '送信する'}
              {status !== 'submitting' && <Send className="w-4 h-4" />}
            </button>
          </form>
        )}
      </div>
    </section>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'プライバシーポリシー ｜ エリアスコア',
  description: 'プライバシーポリシー（準備中）',
}

// プライバシーポリシー プレースホルダ。
// TODO(PO): 取得する個人情報の項目・利用目的・第三者提供・開示請求・
//   問い合わせ窓口・改定履歴などを記載する。
export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="max-w-3xl mx-auto px-4 py-16">
        <Link href="/" className="text-sm text-blue-600 hover:text-blue-700">← トップへ戻る</Link>
        <h1 className="text-2xl sm:text-3xl font-bold mt-6 mb-4">プライバシーポリシー</h1>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          このページは準備中です。正式公開までに内容を掲載します。
        </div>
        {/* TODO(PO): 確定情報に差し替え */}
      </div>
    </main>
  )
}

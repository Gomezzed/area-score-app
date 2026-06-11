import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: '利用規約 ｜ エリアスコア',
  description: '利用規約（準備中）',
}

// 利用規約 プレースホルダ。
// TODO(PO): サービス内容・契約・料金・禁止事項・免責・解約・準拠法などを記載する。
export default function TermsPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="max-w-3xl mx-auto px-4 py-16">
        <Link href="/" className="text-sm text-blue-600 hover:text-blue-700">← トップへ戻る</Link>
        <h1 className="text-2xl sm:text-3xl font-bold mt-6 mb-4">利用規約</h1>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          このページは準備中です。正式公開までに内容を掲載します。
        </div>
        {/* TODO(PO): 確定情報に差し替え */}
      </div>
    </main>
  )
}

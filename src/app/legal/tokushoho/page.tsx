import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: '特定商取引法に基づく表記 ｜ エリアスコア',
  description: '特定商取引法に基づく表記（準備中）',
}

// 特商法表記プレースホルダ。
// TODO(PO): 下記の各項目を確定情報で埋める。
//   - 販売事業者 / 運営統括責任者 / 所在地 / 電話番号 / メールアドレス
//   - 販売価格（各プランの税込価格）/ 支払方法 / 支払時期
//   - 役務の提供時期 / 返品・キャンセルに関する特約
export default function TokushohoPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="max-w-3xl mx-auto px-4 py-16">
        <Link href="/" className="text-sm text-blue-600 hover:text-blue-700">← トップへ戻る</Link>
        <h1 className="text-2xl sm:text-3xl font-bold mt-6 mb-4">特定商取引法に基づく表記</h1>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          このページは準備中です。正式公開までに内容を掲載します。
        </div>
        {/* TODO(PO): 確定情報に差し替え */}
      </div>
    </main>
  )
}

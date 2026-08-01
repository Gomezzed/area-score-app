import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Logo } from '@/components/Logo'

// /legal/* 共通シェル。LP のライトセクションと統一した白背景・slate 系の
// 読みやすいレイアウト。375px でも崩れないレスポンシブ。
const LEGAL_LINKS = [
  { href: '/legal/tokushoho', label: '特定商取引法に基づく表記' },
  { href: '/legal/privacy', label: 'プライバシーポリシー' },
  { href: '/legal/terms', label: '利用規約' },
]

export function LegalShell({
  title,
  established,
  children,
}: {
  title: string
  established?: string
  children: React.ReactNode
}) {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      {/* ヘッダー（LP と同じロゴ） */}
      <header className="border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2">
            <Logo size="md" />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition-colors whitespace-nowrap"
          >
            <ArrowLeft className="w-4 h-4" />
            トップへ戻る
          </Link>
        </div>
      </header>

      {/* 本文 */}
      <article className="max-w-3xl mx-auto px-4 py-12 sm:py-16">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{title}</h1>
        {established && <p className="text-sm text-slate-500 mt-3">{established}</p>}
        <div className="mt-8 space-y-8">{children}</div>
      </article>

      {/* フッター（他の法的文書へのクロスリンク） */}
      <footer className="border-t border-slate-200">
        <div className="max-w-3xl mx-auto px-4 py-8">
          <p className="text-xs font-semibold text-slate-400 mb-3">法的情報</p>
          <ul className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-6">
            {LEGAL_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="text-sm text-slate-600 hover:text-brand-700 transition-colors">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-400 mt-6">© 2026 エリアスコア</p>
        </div>
      </footer>
    </main>
  )
}

// 条文見出し
export function LegalHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-bold text-slate-900 mb-2">{children}</h2>
}

// 本文段落
export function LegalParagraph({ children }: { children: React.ReactNode }) {
  return <p className="text-[15px] text-slate-700 leading-relaxed">{children}</p>
}

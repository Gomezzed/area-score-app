import Link from 'next/link'
import { Logo } from '@/components/Logo'

// ⑪ Footer（ライト）
//   運営者情報 / 特商法表記 / プライバシーポリシー / 利用規約 / データ出典・REINFOLIB クレジット
const LINKS = [
  { href: '#features', label: '機能' },
  { href: '#pricing', label: '料金' },
  { href: '#faq', label: 'FAQ' },
  { href: '#contact', label: 'お問い合わせ' },
  { href: '/login', label: 'ログイン' },
]

const LEGAL = [
  { href: '/legal/tokushoho', label: '特定商取引法に基づく表記' },
  { href: '/legal/privacy', label: 'プライバシーポリシー' },
  { href: '/legal/terms', label: '利用規約' },
]

export function Footer() {
  return (
    <footer className="bg-page-bg text-slate-900 border-t border-slate-200">
      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="grid gap-10 md:grid-cols-3">
          {/* 運営者情報 */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Logo size="md" />
            </div>
            <p className="text-slate-500 text-sm leading-relaxed">
              不動産・マーケティング向けの地域分析SaaS。
              公的データをエリアスコアで可視化し、営業エリアの意思決定を支援します。
            </p>
            {/* TODO(PO): 運営会社名・所在地・代表者などの会社情報を記載 */}
            <p className="text-slate-400 text-xs mt-4">運営: エリアスコア運営事務局</p>
          </div>

          {/* ナビ */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-4">サービス</h3>
            <ul className="space-y-2.5">
              {LINKS.map((l) => (
                <li key={l.href}>
                  {l.href.startsWith('#') ? (
                    <a href={l.href} className="text-sm text-slate-500 hover:text-brand-700 transition-colors">
                      {l.label}
                    </a>
                  ) : (
                    <Link href={l.href} className="text-sm text-slate-500 hover:text-brand-700 transition-colors">
                      {l.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* 法務 */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-4">法的情報</h3>
            <ul className="space-y-2.5">
              {LEGAL.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-slate-500 hover:text-brand-700 transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* データ出典・クレジット */}
        <div className="border-t border-slate-200 mt-10 pt-8 space-y-3">
          <p className="text-xs text-slate-500 leading-relaxed">
            データ出典: 総務省 e-Stat（政府統計の総合窓口）／ 国土交通省 不動産情報ライブラリ ／ 国土数値情報（国土交通省）
          </p>
          {/* REINFOLIB 出典クレジット（規約義務・文言は一字一句固定） */}
          <p className="text-xs text-slate-400 leading-relaxed">
            このサービスは、国土交通省不動産情報ライブラリのAPI機能を使用していますが、提供情報の最新性、正確性、完全性等が保証されたものではありません。
          </p>
        </div>

        <div className="border-t border-slate-200 mt-8 pt-6 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-xs text-slate-400">© 2026 AreaScore</p>
          <p className="text-xs text-slate-400">先行申込受付中（2026年9月30日まで）</p>
        </div>
      </div>
    </footer>
  )
}

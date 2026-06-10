import Link from 'next/link'
import { BETA_PLANS, betaCheckoutHref } from '@/lib/plans'
import {
  MapPin,
  TrendingUp,
  Building2,
  FileSpreadsheet,
  LogIn,
  ArrowRight,
  Check,
  Database,
  MousePointerClick,
  Map,
} from 'lucide-react'

export const metadata = {
  title: 'エリアスコア ｜ 媒介取得の打率を、データで上げる。',
  description:
    '人口動態と不動産取引データを掛け合わせて、エリアの集客ポテンシャルを100点満点でスコア化。不動産仲介・Web広告の優先順位を、勘ではなくデータで決める。',
}

const FEATURES = [
  {
    icon: TrendingUp,
    title: 'エリアスコア',
    body: '人口増減率・取引件数・平均価格水準を独自指標で統合し、100点満点でスコア化。A・B・Cの3段階Tier表示で営業優先度がひと目で判別できます。',
  },
  {
    icon: Building2,
    title: '全国1,916市区町村',
    body: '国勢調査ベースの人口データに加え、不動産取引価格・成約件数を網羅。政令指定都市は区単位まで対応。',
  },
  {
    icon: Map,
    title: '地図ヒートマップ',
    body: 'エリアスコアを地図上にヒートマップ表示。強いエリア・弱いエリアの分布を直感的に把握し、商圏の見極めに活用できます。',
  },
  {
    icon: FileSpreadsheet,
    title: 'CSV・レポート出力',
    body: '分析結果をワンクリックでCSV出力。上位プランではPDFレポートやエリア比較にも対応します。',
  },
]

const STEPS = [
  { icon: LogIn, title: 'ログイン', body: 'メールまたはGoogleアカウントで数秒で登録。' },
  { icon: MousePointerClick, title: 'エリア選択', body: '地方・都道府県を選び、気になる市区町村をクリック。' },
  { icon: Database, title: 'スコア確認・出力', body: 'エリアスコアと取引データを確認し、必要に応じてCSV出力。' },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Nav */}
      <header className="border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <MapPin className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-lg">エリアスコア</span>
          </div>
          <nav className="flex items-center gap-2 sm:gap-4">
            <Link href="/pricing" className="text-sm text-slate-300 hover:text-white transition-colors px-2 py-1">
              料金
            </Link>
            <Link href="/login" className="text-sm text-slate-300 hover:text-white transition-colors px-2 py-1">
              ログイン
            </Link>
            <Link
              href="/pricing"
              className="text-sm bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg px-3 sm:px-4 py-2 transition-colors"
            >
              プランを見る
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 py-20 sm:py-28 text-center">
        <div className="inline-flex items-center gap-2 bg-blue-600/15 border border-blue-500/40 text-blue-300 text-xs font-medium rounded-full px-3 py-1 mb-7">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
          クローズドβ受付中
        </div>
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight leading-tight">
          エリアスコアで、
          <br className="hidden sm:block" />
          <span className="text-blue-400">媒介取得の打率を上げる。</span>
        </h1>
        <p className="text-slate-400 text-lg sm:text-xl mt-6 max-w-2xl mx-auto">
          人口動態と不動産取引データを掛け合わせて、エリアの集客ポテンシャルを100点満点でスコア化。
          不動産仲介・Web広告の優先順位を、勘ではなくデータで決める。
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-10">
          <Link
            href="#pricing"
            className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg px-8 py-4 flex items-center justify-center gap-2 transition-colors"
          >
            プランを見る
            <ArrowRight className="w-5 h-5" />
          </Link>
          <Link
            href="/login"
            className="w-full sm:w-auto bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold rounded-lg px-8 py-4 transition-colors"
          >
            ログイン
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-slate-800/60 border border-slate-700 rounded-2xl p-8">
              <div className="w-12 h-12 bg-blue-600/20 rounded-xl flex items-center justify-center mb-5">
                <f.icon className="w-6 h-6 text-blue-400" />
              </div>
              <h3 className="text-lg font-bold mb-2">{f.title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-12">使い方は3ステップ</h2>
        <div className="grid gap-8 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.title} className="text-center">
              <div className="relative inline-flex items-center justify-center w-16 h-16 bg-slate-800 border border-slate-700 rounded-2xl mb-5">
                <s.icon className="w-7 h-7 text-blue-400" />
                <span className="absolute -top-2 -right-2 w-6 h-6 bg-blue-600 rounded-full text-xs font-bold flex items-center justify-center">
                  {i + 1}
                </span>
              </div>
              <h3 className="text-lg font-bold mb-2">{s.title}</h3>
              <p className="text-slate-400 text-sm max-w-xs mx-auto">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing (condensed) */}
      <section id="pricing" className="max-w-6xl mx-auto px-4 py-16 scroll-mt-20">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-3">料金プラン</h2>
        <p className="text-slate-400 text-center mb-4">用途に合わせて選べる3つのプラン</p>
        <div className="max-w-2xl mx-auto mb-12 bg-blue-600/10 border border-blue-500/30 rounded-xl px-5 py-3 text-center">
          <p className="text-blue-200 text-sm">
            β期間中のご契約価格は、契約継続中ずっと据え置き。今後の通常価格改定の影響を受けません。
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-3 items-start max-w-4xl mx-auto">
          {BETA_PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`relative rounded-2xl border p-6 flex flex-col h-full ${
                plan.recommended ? 'border-blue-500 bg-slate-800' : 'border-slate-700 bg-slate-800/60'
              }`}
            >
              {plan.recommended && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                  おすすめ
                </span>
              )}
              <h3 className="text-base font-bold">{plan.name}</h3>
              <p className="text-slate-400 text-xs mt-1">{plan.description}</p>
              <div className="mt-3 mb-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold">{plan.betaPriceLabel}</span>
                <span className="text-slate-400 text-sm">/月</span>
                <span className="bg-blue-600/20 text-blue-300 text-[10px] font-bold px-1.5 py-0.5 rounded">β特別</span>
              </div>
              <p className="text-slate-500 text-xs mb-4">
                通常 <span className="line-through">{plan.regularPriceLabel}</span>
              </p>
              <ul className="space-y-2 mb-6 flex-1">
                {plan.features.slice(0, 3).map((feat) => (
                  <li key={feat} className="flex items-start gap-2 text-xs text-slate-300">
                    <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>
              {plan.comingSoon ? (
                // β期間中は未提供（Stripe商品未作成）。CTA を出さず Coming Soon 表記。
                <span
                  className="w-full text-center rounded-lg px-4 py-2.5 text-sm font-medium bg-slate-700/50 text-slate-400 cursor-not-allowed"
                  aria-disabled="true"
                >
                  Coming Soon
                </span>
              ) : (
                <a
                  href={betaCheckoutHref(plan.id)}
                  className={`w-full text-center rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                    plan.recommended
                      ? 'bg-blue-600 hover:bg-blue-500 text-white'
                      : 'bg-slate-700 hover:bg-slate-600 text-white'
                  }`}
                >
                  {plan.name}を始める
                </a>
              )}
            </div>
          ))}
        </div>
        <p className="text-center mt-8">
          <Link href="/pricing" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
            プランの詳細を見る →
          </Link>
        </p>
      </section>

      {/* Final CTA */}
      <section className="max-w-6xl mx-auto px-4 py-20">
        <div className="bg-gradient-to-br from-blue-700 to-blue-600 rounded-3xl px-6 py-16 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold">クローズドβ受付中</h2>
          <p className="text-blue-100 mt-4 max-w-xl mx-auto">
            β期間中のご契約価格は、契約継続中ずっと据え置き。今のうちに、エリアスコアを営業の標準装備に。
          </p>
          <a
            href={betaCheckoutHref('standard')}
            className="inline-flex items-center justify-center gap-2 mt-8 bg-white hover:bg-slate-100 text-blue-700 font-semibold rounded-lg px-8 py-4 transition-colors"
          >
            Standardを始める
            <ArrowRight className="w-5 h-5" />
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800">
        <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-slate-400">
              <MapPin className="w-4 h-4" />
              <span className="text-sm font-medium text-slate-300">エリアスコア</span>
              <span className="text-xs text-slate-500 hidden sm:inline">不動産・マーケティング向け地域分析SaaS</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-slate-400">
              <Link href="/pricing" className="hover:text-white transition-colors">料金</Link>
              <Link href="/login" className="hover:text-white transition-colors">ログイン</Link>
              <Link href="/help" className="hover:text-white transition-colors">使い方</Link>
            </div>
          </div>
          <div className="border-t border-slate-800/70 pt-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <p className="text-xs text-slate-500">
              データ出典: 総務省 e-Stat / 国土交通省 不動産情報ライブラリ / 国土数値情報
            </p>
            <p className="text-xs text-slate-500">© 2026 エリアスコア</p>
          </div>
        </div>
      </footer>
    </div>
  )
}

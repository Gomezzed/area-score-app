import Link from 'next/link'
import { PLANS } from '@/lib/plans'
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
} from 'lucide-react'

export const metadata = {
  title: 'エリア人口分析 ｜ 不動産営業の意思決定を、データで。',
  description:
    '全国1,916市区町村の人口動態・不動産取引データを可視化。エリアの将来性をデータで判断する不動産営業向け分析ツール。',
}

const FEATURES = [
  {
    icon: TrendingUp,
    title: '人口動態分析',
    body: '2015年→2020年の人口増減率を市区町村ごとに可視化。伸びるエリア・縮むエリアが一目でわかります。',
  },
  {
    icon: Building2,
    title: '全国1,916市区町村',
    body: '国勢調査ベースの人口データに加え、不動産取引価格・成約件数を網羅。政令指定都市は区単位まで対応。',
  },
  {
    icon: FileSpreadsheet,
    title: 'CSV・レポート出力',
    body: '分析結果をワンクリックでCSV出力。STANDARDプランではPDFレポートやエリア比較にも対応します。',
  },
]

const STEPS = [
  { icon: LogIn, title: 'ログイン', body: 'メールまたはGoogleアカウントで数秒で登録。' },
  { icon: MousePointerClick, title: 'エリア選択', body: '地方・都道府県を選び、気になる市区町村をクリック。' },
  { icon: Database, title: 'データ確認・出力', body: '人口動態と取引データを確認し、必要に応じてCSV出力。' },
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
            <span className="font-bold text-lg">エリア人口分析</span>
          </div>
          <nav className="flex items-center gap-2 sm:gap-4">
            <Link href="/pricing" className="text-sm text-slate-300 hover:text-white transition-colors px-2 py-1">
              料金
            </Link>
            <Link href="/login" className="text-sm text-slate-300 hover:text-white transition-colors px-2 py-1">
              ログイン
            </Link>
            <Link
              href="/register"
              className="text-sm bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg px-3 sm:px-4 py-2 transition-colors"
            >
              無料で始める
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 py-20 sm:py-28 text-center">
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight leading-tight">
          不動産営業の意思決定を、
          <br className="hidden sm:block" />
          <span className="text-blue-400">データで。</span>
        </h1>
        <p className="text-slate-400 text-lg sm:text-xl mt-6 max-w-2xl mx-auto">
          全国1,916市区町村の人口動態と不動産取引データを、ひとつの画面に。
          エリアの将来性を根拠を持って語れるようになります。
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-10">
          <Link
            href="/register"
            className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg px-8 py-4 flex items-center justify-center gap-2 transition-colors"
          >
            無料で始める
            <ArrowRight className="w-5 h-5" />
          </Link>
          <Link
            href="/pricing"
            className="w-full sm:w-auto bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold rounded-lg px-8 py-4 transition-colors"
          >
            料金を見る
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <div className="grid gap-6 md:grid-cols-3">
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
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-3">料金プラン</h2>
        <p className="text-slate-400 text-center mb-12">用途に合わせて選べる3つのプラン</p>
        <div className="grid gap-6 md:grid-cols-3 items-start max-w-4xl mx-auto">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`relative rounded-2xl border p-6 flex flex-col h-full ${
                plan.recommended
                  ? 'border-blue-500 bg-slate-800'
                  : 'border-slate-700 bg-slate-800/60'
              }`}
            >
              {plan.recommended && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                  推奨
                </span>
              )}
              <h3 className="text-base font-bold">{plan.name}</h3>
              <div className="mt-2 mb-4">
                <span className="text-2xl font-bold">{plan.priceLabel}</span>
                {plan.price > 0 && <span className="text-slate-400 text-sm">/月</span>}
              </div>
              <ul className="space-y-2 mb-6 flex-1">
                {plan.features.slice(0, 3).map((feat) => (
                  <li key={feat} className="flex items-start gap-2 text-xs text-slate-300">
                    <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/pricing"
                className={`w-full text-center rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                  plan.recommended
                    ? 'bg-blue-600 hover:bg-blue-500 text-white'
                    : 'bg-slate-700 hover:bg-slate-600 text-white'
                }`}
              >
                詳細を見る
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-6xl mx-auto px-4 py-20">
        <div className="bg-gradient-to-br from-blue-700 to-blue-600 rounded-3xl px-6 py-16 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold">今すぐ無料で始める</h2>
          <p className="text-blue-100 mt-4 max-w-xl mx-auto">
            クレジットカード不要。まずは無料プランでエリア分析を体験してください。
          </p>
          <Link
            href="/register"
            className="inline-flex items-center justify-center gap-2 mt-8 bg-white hover:bg-slate-100 text-blue-700 font-semibold rounded-lg px-8 py-4 transition-colors"
          >
            無料で始める
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800">
        <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-slate-400">
            <MapPin className="w-4 h-4" />
            <span className="text-sm">エリア人口分析</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-slate-400">
            <Link href="/pricing" className="hover:text-white transition-colors">料金</Link>
            <Link href="/login" className="hover:text-white transition-colors">ログイン</Link>
            <Link href="/help" className="hover:text-white transition-colors">使い方</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

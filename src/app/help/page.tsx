import type { Metadata } from 'next'
import Link from 'next/link'
import { MapPin, ArrowLeft, BookOpen, HelpCircle, Database, BarChart2, List } from 'lucide-react'

export const metadata: Metadata = {
  title: '使い方ガイド | エリアスコア分析',
  description: 'エリアスコア分析ダッシュボードの使い方・用語説明・FAQ',
}

const GLOSSARY = [
  {
    term: 'スコア（Score）',
    definition: '各市区町村の総合評価スコア（0〜100点）。人口・世帯数増減・人口密度などを総合的に評価した数値。高いほど優良エリアを示す。',
  },
  {
    term: 'Tier A',
    badge: 'A',
    definition: 'スコア上位の優良エリア（70点以上）。不動産仲介・媒介取得の最優先ターゲット。',
  },
  {
    term: 'Tier B',
    badge: 'B',
    definition: '中程度スコアのエリア（40〜69点）。次点のターゲットエリア。',
  },
  {
    term: 'Tier C',
    badge: 'C',
    definition: 'スコアが低いエリア（40点未満）。参考情報として確認。',
  },
  {
    term: '人口増減率',
    definition: '直近の国勢調査2期分を比較した人口変化率（%）。プラスは人口増加、マイナスは人口減少を示す。',
  },
  {
    term: '世帯数',
    definition: '各市区町村の総世帯数。住宅需要の規模を示す指標。',
  },
  {
    term: '人口密度',
    definition: '1km²あたりの人口数（人/km²）。エリアの過密度・都市化度合いを示す。',
  },
  {
    term: 'e-Stat',
    definition: '日本の政府統計ポータルサイト（統計の総合窓口）。本アプリのデータソース。総務省統計局が運営。',
  },
]

const STEPS = [
  'エリアタブを選択する（仙台・愛知・東海・関東・近畿など）',
  '都市/市区町村リストが表示される',
  'Tierフィルターで絞り込む（Tier A/B/C）',
  'キーワード検索で市区町村を検索できる',
  '各エリアのスコアと詳細データを確認する',
  'CSVエクスポートボタンでデータをダウンロードできる',
]

const FAQS = [
  {
    q: 'スコアはどのように計算されていますか？',
    a: '人口規模・人口増減率・世帯数・人口密度などの指標を重み付けして総合スコアを算出しています。取引件数40%・人口増減30%・価格水準30%の配分で計算しています。',
  },
  {
    q: 'データの出典は何ですか？',
    a: '総務省統計局が提供するe-Stat（政府統計の総合窓口）のAPIと、国土交通省の不動産取引価格情報APIを使用しています。',
  },
  {
    q: '対応エリアはどこですか？',
    a: '現在、仙台・愛知・鹿児島・東海（静岡・岐阜・三重）・関東（東京・神奈川・千葉・埼玉）・近畿（大阪・兵庫）に対応しています。',
  },
  {
    q: 'データはどのくらいの頻度で更新されますか？',
    a: '毎月1日にGitHub Actionsで自動更新されます。最新の国勢調査データと不動産取引データを反映しています。',
  },
  {
    q: 'CSVファイルはどのように使いますか？',
    a: 'Salesforce等のCRMへのインポートや、Excelでの独自分析に利用できます。市区町村名・スコア・Tier・人口増減率・取引件数が含まれます。',
  },
]

const TIER_BADGE_CLASSES: Record<string, string> = {
  A: 'bg-emerald-900/60 text-emerald-300 border border-emerald-700',
  B: 'bg-amber-900/60 text-amber-300 border border-amber-700',
  C: 'bg-red-900/60 text-red-300 border border-red-700',
}

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <MapPin className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-white font-bold text-lg">エリアスコア分析</h1>
          <span className="text-slate-500 text-sm hidden sm:inline">／</span>
          <span className="text-slate-400 text-sm hidden sm:inline">使い方ガイド</span>
        </div>
        <Link
          href="/dashboard"
          className="flex items-center gap-2 px-3 py-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg text-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          ダッシュボードへ
        </Link>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">

        {/* Page title */}
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-blue-400" />
            使い方ガイド
          </h2>
          <p className="text-slate-400 mt-1 text-sm">
            エリアスコア分析ダッシュボードの機能・用語・操作方法を説明します。
          </p>
        </div>

        {/* Section 1: アプリ概要 */}
        <section className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-blue-400" />
            アプリ概要
          </h3>
          <p className="text-slate-300 text-sm leading-relaxed">
            このアプリは<span className="text-white font-medium">不動産エリアスコアリングSaaS</span>です。
            各市区町村の人口・世帯数・人口増減などのデータを自動収集し、スコア化して表示します。
            不動産仲介・媒介取得のエリア選定を効率化するための意思決定支援ツールとして活用できます。
          </p>
          <ul className="mt-4 space-y-2">
            {[
              '全国主要エリアの市区町村データを自動収集・スコア化',
              'Tier A / B / C によるエリア優先順位付け',
              '地図上でのエリア可視化',
              'Salesforce対応CSVエクスポート',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-slate-400">
                <span className="text-blue-400 mt-0.5">•</span>
                {item}
              </li>
            ))}
          </ul>
        </section>

        {/* Section 2: 用語の定義 */}
        <section className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-400" />
            用語の定義
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left text-slate-400 font-medium pb-2 pr-4 w-40">用語</th>
                  <th className="text-left text-slate-400 font-medium pb-2">説明</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {GLOSSARY.map(({ term, badge, definition }) => (
                  <tr key={term} className="align-top">
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-medium whitespace-nowrap">{term}</span>
                        {badge && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${TIER_BADGE_CLASSES[badge]}`}>
                            Tier {badge}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 text-slate-400 leading-relaxed">{definition}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 3: 使い方 */}
        <section className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <List className="w-5 h-5 text-blue-400" />
            使い方（ステップガイド）
          </h3>
          <ol className="space-y-3">
            {STEPS.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <span className="text-slate-300 text-sm leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* Section 4: データ更新 */}
        <section className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
            <Database className="w-5 h-5 text-blue-400" />
            データ更新について
          </h3>
          <ul className="space-y-3">
            {[
              'データはe-Stat（政府統計ポータル）と国土交通省不動産取引APIから自動収集しています',
              '毎月1日にGitHub Actionsで自動更新されます',
              '最新の国勢調査データおよび直近4四半期の不動産取引データを反映しています',
              '手動での即時更新が必要な場合は管理者にお問い合わせください',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-slate-400">
                <span className="text-emerald-400 mt-0.5 flex-shrink-0">✓</span>
                {item}
              </li>
            ))}
          </ul>
        </section>

        {/* Section 5: FAQ */}
        <section className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-blue-400" />
            よくある質問
          </h3>
          <div className="space-y-5">
            {FAQS.map(({ q, a }) => (
              <div key={q} className="border-b border-slate-700/50 last:border-0 pb-5 last:pb-0">
                <p className="text-white text-sm font-medium mb-2">Q. {q}</p>
                <p className="text-slate-400 text-sm leading-relaxed">A. {a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Footer */}
        <div className="text-center pb-4">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            ダッシュボードに戻る
          </Link>
        </div>

      </main>
    </div>
  )
}

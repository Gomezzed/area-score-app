import type { Metadata } from 'next'
import Link from 'next/link'
import { MapPin, ArrowLeft, BookOpen, HelpCircle, Database, BarChart2, List, Info } from 'lucide-react'

export const metadata: Metadata = {
  title: '使い方ガイド | エリアスコア分析',
  description: 'エリアスコア分析ダッシュボードの使い方・用語説明・FAQ',
}

const GLOSSARY = [
  {
    term: '人口（2025年・速報）',
    definition: '令和7年（2025年）国勢調査 速報集計の総人口（実数）。確定値は後日公表予定。アプリ上では「197.5万人」のように万人単位で表示。',
  },
  {
    term: '人口増減率',
    definition: '2020年（令和2年）→2025年（令和7年・速報）の変化率（%）。青色の▲はプラス（人口増加）、赤色の▼はマイナス（人口減少）を示す。',
  },
  {
    term: '人口増減数',
    definition: '2020年→2025年（速報）の人口の増減（実数）。例: +1,234人 / -567人。',
  },
  {
    term: '世帯数',
    definition: '令和7年（2025年）国勢調査 速報集計時点の各市区町村の総世帯数。住宅需要の規模を示す指標。',
  },
  {
    term: 'e-Stat',
    definition: '日本の政府統計ポータルサイト（統計の総合窓口）。総務省統計局が運営。本アプリの人口データソース。',
  },
  {
    term: 'マンション取引件数',
    definition: '国土交通省に届け出のあった中古マンション売買の成約件数。市区町村詳細パネルで年別の推移を表示。',
  },
  {
    term: '平均㎡単価',
    definition: '成約物件の1平方メートルあたりの平均価格（万円）。物件規模の影響を除いた価格水準の比較に用いる。',
  },
  {
    term: '平均取引価格',
    definition: '成約物件の平均成約価格（万円）。',
  },
  {
    term: '駅乗降客数（最新）',
    definition: 'その市区町村内にある鉄道駅の1日あたり乗降客数の合計（最新値）。最新は令和5年度（2023年）データを採用し、欠損時は前年以前に遡って補完。鉄道駅のない市区町村では表示されません。市区町村詳細パネルに合計値を表示します。',
  },
  {
    term: 'データ出典',
    definition: '人口: 総務省統計局 e-Stat（https://www.e-stat.go.jp/）の令和7年（2025年）国勢調査 速報集計（2015・2020年は確定値）。マンション取引: 国土交通省 不動産情報ライブラリ 不動産価格（成約価格）情報 XIT001。駅乗降客数: 国土交通省 不動産情報ライブラリ 国土数値情報 駅別乗降客数 XKT015（令和5年度＝2023年データ）。不動産情報ライブラリ: https://www.reinfolib.mlit.go.jp/',
  },
]

const STEPS = [
  '地方タブを選択する（北海道／東北／関東／東海／北陸／近畿／中国／四国／九州／沖縄）',
  '都道府県ドロップダウンから都道府県を選ぶ',
  '左パネルに市区町村の一覧（人口・増減率・増減数）が表示される',
  'キーワード検索で市区町村を絞り込める',
  '政令指定都市（「政令市」バッジ付き）はタップすると行政区（区）一覧に展開できる',
  '地図のマーカー色（増減率）で人口動態を俯瞰し、クリックで詳細を確認する',
  'CSV出力ボタンで市区町村データをダウンロードできる',
]

const FAQS = [
  {
    q: '人口データはいつの時点のものですか？',
    a: '令和7年（2025年）国勢調査 速報集計です（確定値は後日公表予定）。人口増減率・増減数は令和2年（2020年）国勢調査との比較で算出しています。',
  },
  {
    q: '人口増減率はどのように計算していますか？',
    a: '（2025年人口 − 2020年人口）÷ 2020年人口 × 100（%）で算出しています。地図のマーカーはこの増減率で色分けしています。',
  },
  {
    q: 'データの出典は何ですか？',
    a: '総務省統計局が提供するe-Stat（政府統計の総合窓口）の国勢調査データ（API）を使用しています。',
  },
  {
    q: '対応エリアはどこですか？',
    a: '全国47都道府県・全市区町村（約1,700）に対応しています。地方タブと都道府県ドロップダウンで切り替えられます。',
  },
  {
    q: 'CSVファイルはどのように使いますか？',
    a: 'Excel等での独自分析に利用できます。都道府県・市区町村名・市区町村コード・人口（2025速報/2020/2015）・世帯数・人口増減数・人口増減率が含まれます。',
  },
  {
    q: '政令指定都市の区ごとのデータは見られますか？',
    a: '札幌市・横浜市・名古屋市・大阪市など20の政令指定都市は、リストでタップすると行政区（例: 名古屋市西区）の一覧に展開され、区ごとの人口・増減率・地図マーカー（区役所代表点）を確認できます。',
  },
  {
    q: 'スマートフォンでも利用できますか？',
    a: 'はい。スマートフォン・タブレットの画面幅に最適化されています。リストと地図は縦に並び、市区町村をタップすると詳細が全画面で表示されます。',
  },
]

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <MapPin className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-white font-bold text-lg">エリアスコア</h1>
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
            このアプリは<span className="text-white font-medium">市区町村 人口動態ダッシュボード</span>です。
            総務省統計局の国勢調査（2015年・2020年・2025年速報）をもとに、全国47都道府県・全市区町村の人口・世帯数・
            人口増減を地図とリストで可視化します。エリアの人口動態を把握するための分析ツールとして活用できます。
          </p>
          <ul className="mt-4 space-y-2">
            {[
              '全国47都道府県・全市区町村の国勢調査人口データを収録',
              '2020→2025の人口増減率・増減数を可視化',
              '地図マーカーを増減率で色分け表示',
              '市区町村データのCSVエクスポート',
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
                {GLOSSARY.map(({ term, definition }) => (
                  <tr key={term} className="align-top">
                    <td className="py-3 pr-4">
                      <span className="text-white font-medium whitespace-nowrap">{term}</span>
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
              'データはe-Stat（政府統計の総合窓口）の国勢調査APIから収集しています',
              '人口・世帯数は令和7年（2025年）国勢調査 速報集計です',
              '人口増減率・増減数は令和2年（2020年）国勢調査との比較値です',
              '現在は速報集計値です。確定値の公表後に差し替え予定です',
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

        {/* Section 6: データ出典・免責事項 */}
        <section className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Info className="w-5 h-5 text-blue-400" />
            データ出典・免責事項
          </h3>
          <ul className="space-y-2 mb-4">
            {[
              '人口データ: 総務省 e-Stat（政府統計の総合窓口）令和2年国勢調査',
              '不動産取引データ: 国土交通省 不動産情報ライブラリ',
              '駅乗降客数: 国土数値情報（国土交通省）',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-slate-400">
                <span className="text-blue-400 mt-0.5 flex-shrink-0">•</span>
                {item}
              </li>
            ))}
          </ul>
          {/* REINFOLIB 出典クレジット（規約義務・文言は一字一句固定） */}
          <p className="text-xs text-slate-500 leading-relaxed border-t border-slate-700/50 pt-4">
            このサービスは、国土交通省不動産情報ライブラリのAPI機能を使用していますが、提供情報の最新性、正確性、完全性等が保証されたものではありません。
          </p>
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

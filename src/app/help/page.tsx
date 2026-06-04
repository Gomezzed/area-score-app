import Link from 'next/link'
import { ArrowLeft, BookOpen } from 'lucide-react'

const GLOSSARY = [
  {
    term: '人口（最新）',
    desc: '住民基本台帳に基づく最新年の市区町村別人口数（人）。e-Stat（総務省統計局）が公開するデータを使用。',
  },
  {
    term: '人口増減数（前回比）',
    desc: '前回調査年と最新年の人口差（人）。プラスは増加、マイナスは減少を示す。',
  },
  {
    term: '人口増減率（%）',
    desc: '前回調査年からの人口変化率（%）。算式: (最新人口 − 前回人口) ÷ 前回人口 × 100。',
  },
  {
    term: '取引件数',
    desc: 'その市区町村で成約したマンション・中古マンションの売買件数（国土交通省届出ベース）。',
  },
  {
    term: '平均㎡単価',
    desc: '成約した物件の1平方メートルあたりの平均価格（円）。物件の広さの違いを排除した価格指標。',
  },
  {
    term: '平均価格',
    desc: '成約物件の平均成約価格（万円）。',
  },
  {
    term: 'データ出典（人口）',
    desc: 'e-Stat 住民基本台帳人口・世帯数（総務省統計局）https://www.e-stat.go.jp/',
  },
  {
    term: 'データ出典（不動産）',
    desc: '国土交通省 不動産取引価格情報 https://www.land.mlit.go.jp/webland/',
  },
]

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="flex items-center gap-3 mb-8">
          <Link
            href="/dashboard"
            className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            ダッシュボードへ
          </Link>
        </div>

        <div className="flex items-center gap-3 mb-8">
          <BookOpen className="w-6 h-6 text-blue-400" />
          <h1 className="text-2xl font-bold">用語集・データ説明</h1>
        </div>

        <div className="space-y-4">
          {GLOSSARY.map((item) => (
            <div key={item.term} className="bg-slate-800 border border-slate-700 rounded-xl p-5">
              <dt className="text-sm font-semibold text-blue-300 mb-2">{item.term}</dt>
              <dd className="text-sm text-slate-300 leading-relaxed">{item.desc}</dd>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

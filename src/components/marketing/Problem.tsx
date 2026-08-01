import { Compass, Clock, TrendingDown } from 'lucide-react'

// ③ Problem（ライト）— 不動産業界の課題3つ
const PROBLEMS = [
  {
    icon: Compass,
    title: '勘と経験頼みのエリア選定',
    body: 'どの地域で媒介を取るか・広告を打つかが担当者の感覚に依存し、判断のばらつきと機会損失が生まれている。',
  },
  {
    icon: Clock,
    title: '資料作成に毎回30分以上',
    body: '人口や取引データを役所サイトから手作業で集め、提案資料に整える。1エリアあたり30分以上が当たり前になっている。',
  },
  {
    icon: TrendingDown,
    title: '撤退・参入判断の遅れ',
    body: '市場縮小エリアからの撤退、伸びるエリアへの参入。判断の根拠が揃わず、動き出しが一手遅れる。',
  },
]

export function Problem() {
  return (
    <section className="bg-white text-slate-900">
      <div className="max-w-6xl mx-auto px-4 py-20 sm:py-24">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <p className="text-brand-700 font-semibold text-sm mb-3">よくある課題</p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
            エリアの意思決定、まだ「勘」で進めていませんか？
          </h2>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {PROBLEMS.map((p) => (
            <div key={p.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-8">
              <div className="w-12 h-12 rounded-xl bg-white border border-slate-200 flex items-center justify-center mb-5">
                <p.icon className="w-6 h-6 text-slate-700" />
              </div>
              <h3 className="text-lg font-bold mb-2">{p.title}</h3>
              <p className="text-slate-600 text-sm leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

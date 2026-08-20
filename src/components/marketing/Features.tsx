import { ListOrdered, Map, LineChart, FileDown } from 'lucide-react'

// ⑤ Features（ライト）
//   スコア一覧・ランキング / 地図ヒートマップ / 人口推移・駅乗降客数グラフ / PDF・CSV出力
const FEATURES = [
  {
    icon: ListOrdered,
    title: 'スコア一覧・ランキング',
    body: 'エリアスコアを一覧・ランキング表示。A/B/Cのティアで営業優先度がひと目で判別でき、狙うべきエリアがすぐ分かります。',
  },
  {
    icon: Map,
    title: '地図ヒートマップ',
    body: 'スコアを地図上にヒートマップ表示。強いエリア・弱いエリアの分布を直感的に把握し、商圏の見極めに活かせます。',
  },
  {
    icon: LineChart,
    title: '人口推移・駅乗降客数グラフ',
    body: '人口の推移トレンドと駅ごとの乗降客数をグラフで確認。エリアの伸び・集客力を数字の裏付けとともに提示できます。',
  },
  {
    icon: FileDown,
    title: 'PDF・CSV出力',
    body: '分析結果をPDFレポートやCSVでワンクリック出力。提案資料づくりや社内共有、CRMへの取り込みをスムーズにします。',
  },
]

export function Features() {
  return (
    <section id="features" className="bg-white text-slate-900 scroll-mt-16">
      <div className="max-w-6xl mx-auto px-4 py-20 sm:py-24">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <p className="text-brand-700 font-semibold text-sm mb-3">主な機能</p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
            意思決定に必要な情報を、ひとつの画面に。
          </h2>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-slate-200 bg-white p-6 hover:border-brand-300 hover:shadow-lg transition-all"
            >
              <div className="w-12 h-12 rounded-xl bg-brand-100 flex items-center justify-center mb-5">
                <f.icon className="w-6 h-6 text-brand-700" />
              </div>
              <h3 className="text-base font-bold tracking-tight mb-2">{f.title}</h3>
              <p className="text-slate-600 text-sm leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

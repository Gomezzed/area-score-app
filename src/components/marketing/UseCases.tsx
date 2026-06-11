import { Home, Megaphone, Store } from 'lucide-react'

// ⑦ Use cases（ライト）— 3ペルソナ
const CASES = [
  {
    icon: Home,
    persona: '不動産売買仲介',
    title: '媒介を取りに行くエリアを、数字で選ぶ',
    body: '人口が伸び、取引が活発なエリアを特定。反響の見込める地域に営業リソースを集中し、媒介取得の打率を上げる。',
  },
  {
    icon: Megaphone,
    persona: '広告代理店',
    title: '広告出稿エリアの優先順位づけ',
    body: 'クライアントの商材に合うエリアをスコアで提案。出稿エリアの根拠を公的データで示し、提案の説得力を高める。',
  },
  {
    icon: Store,
    persona: '出店企画',
    title: '出店候補地の一次スクリーニング',
    body: '商圏の人口規模・駅の集客力・市場動向をまとめて確認。候補地の絞り込みにかかる調査時間を大幅に短縮する。',
  },
]

export function UseCases() {
  return (
    <section className="bg-white text-slate-900">
      <div className="max-w-6xl mx-auto px-4 py-20 sm:py-24">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <p className="text-blue-600 font-semibold text-sm mb-3">活用シーン</p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
            こんな業務で使われています。
          </h2>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {CASES.map((c) => (
            <div key={c.persona} className="rounded-2xl border border-slate-200 bg-slate-50 p-8 flex flex-col">
              <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center mb-5">
                <c.icon className="w-6 h-6 text-white" />
              </div>
              <p className="text-blue-600 text-xs font-bold mb-2">{c.persona}</p>
              <h3 className="text-lg font-bold mb-3">{c.title}</h3>
              <p className="text-slate-600 text-sm leading-relaxed">{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

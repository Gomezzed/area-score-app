import { Users, TrainFront, Building2, Plus, Equal } from 'lucide-react'

// ④ Solution（ライト）— 3つの公的データを1つのスコアに統合する図解的説明
const SOURCES = [
  {
    icon: Users,
    label: '人口動態',
    sub: '国勢調査・人口推移',
    source: '総務省 e-Stat',
  },
  {
    icon: TrainFront,
    label: '駅乗降客数',
    sub: '駅別の乗降規模',
    source: '国土数値情報',
  },
  {
    icon: Building2,
    label: '不動産取引',
    sub: '成約件数・価格水準',
    source: '国土交通省 不動産情報ライブラリ',
  },
]

export function Solution() {
  return (
    <section className="bg-slate-50 text-slate-900">
      <div className="max-w-6xl mx-auto px-4 py-20 sm:py-24">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <p className="text-blue-600 font-semibold text-sm mb-3">エリアスコアの仕組み</p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
            3つの公的データを、1つの「エリアスコア」に。
          </h2>
          <p className="text-slate-600 mt-4 leading-relaxed">
            バラバラに存在する公的データを独自指標で統合し、エリアの集客ポテンシャルを
            <span className="font-semibold text-slate-900">100点満点</span>で可視化します。
          </p>
        </div>

        {/* 図解: 3データ + → スコア */}
        <div className="flex flex-col lg:flex-row items-stretch justify-center gap-4 lg:gap-3">
          {SOURCES.map((s, i) => (
            <div key={s.label} className="flex flex-col lg:flex-row items-center gap-4 lg:gap-3">
              <div className="w-full lg:w-52 rounded-2xl border border-slate-200 bg-white p-6 text-center">
                <div className="w-12 h-12 mx-auto rounded-xl bg-blue-50 flex items-center justify-center mb-4">
                  <s.icon className="w-6 h-6 text-blue-600" />
                </div>
                <p className="font-bold">{s.label}</p>
                <p className="text-slate-500 text-xs mt-1">{s.sub}</p>
                <p className="text-slate-400 text-[11px] mt-2">出典: {s.source}</p>
              </div>
              {i < SOURCES.length - 1 && (
                <Plus className="w-6 h-6 text-slate-400 shrink-0" />
              )}
            </div>
          ))}

          <Equal className="w-6 h-6 text-slate-400 self-center rotate-90 lg:rotate-0 shrink-0" />

          <div className="w-full lg:w-56 rounded-2xl bg-slate-900 text-white p-6 text-center flex flex-col items-center justify-center">
            <p className="text-sm text-slate-300">エリアスコア</p>
            <p className="text-5xl font-bold mt-2">
              82<span className="text-2xl text-slate-400">/100</span>
            </p>
            <span className="mt-3 inline-block bg-emerald-500/20 text-emerald-300 text-xs font-bold px-3 py-1 rounded-full">
              Tier A
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

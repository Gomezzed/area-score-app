import Image from 'next/image'
import { ArrowRight, ShieldCheck } from 'lucide-react'

export function Hero() {
  return (
    <section id="top" className="relative bg-slate-900 text-white">
      <div className="max-w-6xl mx-auto px-4 pt-16 pb-24 sm:pt-24 sm:pb-32 text-center">
        <div className="inline-flex items-center gap-2 bg-blue-600/15 border border-blue-500/40 text-blue-300 text-xs font-medium rounded-full px-3 py-1 mb-7">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
          クローズドβ受付中
        </div>
        <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.25]">
          「どのエリアで媒介を取るか」を、<br className="hidden sm:block" /><span className="text-blue-400">勘ではなく数字で決める。</span>
        </h1>
        <p className="text-slate-300 text-base sm:text-xl mt-6 max-w-2xl mx-auto leading-relaxed">
          人口動態 × 駅乗降客数 × 不動産取引データをエリアスコアで可視化。営業エリアの意思決定を、<span className="text-emerald-400 font-semibold">30分 → 5分</span>に短縮します。
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-10">
          <a href="#contact" className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg px-8 py-4 flex items-center justify-center gap-2 transition-colors">無料でデモを見る<ArrowRight className="w-5 h-5" /></a>
          <a href="#pricing" className="w-full sm:w-auto bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold rounded-lg px-8 py-4 transition-colors">料金を見る</a>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs sm:text-sm text-slate-400">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-emerald-400" />e-Stat・国土交通省 公式データ使用</span>
          <span className="hidden sm:inline text-slate-600">／</span>
          <span>クローズドβ受付中</span>
        </div>
        <div className="mt-14 max-w-4xl mx-auto">
          <div className="relative rounded-2xl border border-slate-700 bg-slate-800/60 overflow-hidden shadow-2xl">
            <div className="aspect-[16/9] relative">
              <Image src="/lp/dashboard-hero.png" alt="エリアスコアのダッシュボード画面" fill className="object-cover" />
            </div>
          </div>
        </div>
      </div>
      <div className="h-16 sm:h-24 bg-gradient-to-b from-slate-900 to-white" />
    </section>
  )
}

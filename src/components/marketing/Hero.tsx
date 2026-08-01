import Image from 'next/image'
import { ArrowRight, ShieldCheck } from 'lucide-react'

export function Hero() {
  return (
    <section id="top" className="relative bg-white text-slate-900">
      <div className="max-w-6xl mx-auto px-4 pt-16 pb-24 sm:pt-24 sm:pb-32 text-center">
        <div className="inline-flex items-center gap-2 bg-brand-100 text-brand-700 text-xs font-medium rounded-full px-3 py-1 mb-7">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-700" />
          先行申込受付中（2026年8月31日まで）
        </div>
        <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.25]">
          「どのエリアで媒介を取るか」を、<br className="hidden sm:block" /><span className="text-brand-700">勘ではなく数字で決める。</span>
        </h1>
        <p className="text-slate-500 text-base sm:text-xl mt-6 max-w-2xl mx-auto leading-relaxed">
          人口動態 × 駅乗降客数 × 不動産取引データをエリアスコアで可視化。営業エリアの意思決定を、<span className="text-brand-700 font-semibold">30分 → 5分</span>に短縮します。
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-10">
          <a href="#contact" className="w-full sm:w-auto bg-brand-700 hover:bg-brand-500 text-white font-semibold rounded-lg px-8 py-4 flex items-center justify-center gap-2 transition-colors">無料でデモを見る<ArrowRight className="w-5 h-5" /></a>
          <a href="#pricing" className="w-full sm:w-auto bg-white hover:bg-brand-100 border border-[#C7D6E4] text-brand-700 font-semibold rounded-lg px-8 py-4 transition-colors">料金を見る</a>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs sm:text-sm text-slate-400">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-brand-700" />e-Stat・国土交通省 公式データ使用</span>
          <span className="hidden sm:inline text-slate-300">／</span>
          <span>先行申込受付中（2026年8月31日まで）</span>
        </div>
        <div className="mt-14 max-w-4xl mx-auto">
          <div className="relative rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-lg">
            <div className="aspect-[16/9] relative">
              <Image src="/lp/dashboard-hero.png" alt="AreaScore のダッシュボード画面" fill className="object-cover" />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

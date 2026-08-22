import { ChevronDown } from 'lucide-react'
import { Br } from '@/components/marketing/LineBreak'

// ⑨ FAQ（ライト）— 6〜7問
//   先行申込方法 / データ更新頻度 / 解約 / 無料プランの範囲 / 機能アップデート / 対応エリア / サポート
const FAQS = [
  {
    q: '先行申込はどのように行えますか？',
    a: <>ページ下部のお問い合わせフォームよりお申し込みください。<Br />担当より折り返しご案内し、アカウントを発行します。<Br />2026年9月30日までにご契約いただいた価格は、契約継続中ずっと据え置かれます。<Br />※ご解約後に再契約された場合、またはプランを変更された場合は、その時点の通常価格が適用されます。</>,
  },
  {
    q: 'データはどのくらいの頻度で更新されますか？',
    a: <>人口動態・不動産取引・駅乗降客数はいずれも公的データの公開サイクルに合わせて更新します。<Br />元データの公表時期により更新タイミングは異なります。</>,
  },
  {
    q: '解約はいつでもできますか？',
    a: <>はい。管理画面またはサポート窓口からお手続きいただけます。契約期間や返金の取り扱いの詳細は、<Br />お申し込み時にご案内します。</>,
  },
  {
    q: '無料プラン（Free）では何ができますか？',
    a: <>Freeプランでは上位3エリアの閲覧のみご利用いただけます。<Br />全エリアの閲覧やレポート出力をご希望の場合は、Starter以上のプランをご検討ください。</>,
  },
  {
    q: '機能は今後も追加されますか？',
    a: <>はい。エリアスコアは随時アップデートを行っており、<Br />新機能・データ・対応エリアを継続的に拡充しています。<Br />最新情報はご契約者さまに随時ご案内いたします。</>,
  },
  {
    q: '対応エリアはどこまでですか？',
    a: <>全国の市区町村に対応しています（政令指定都市は区単位）。<Br />駅単位データはStandard以上のプランでご利用いただけます。</>,
  },
  {
    q: 'サポート体制を教えてください。',
    a: <>プランに応じてメールサポート／メール優先サポート／Slack・Zoomサポートをご用意しています。<Br />詳細は料金プランをご確認ください。</>,
  },
]

export function FAQ() {
  return (
    <section id="faq" className="bg-slate-50 text-slate-900 scroll-mt-16">
      <div className="max-w-3xl mx-auto px-4 py-20 sm:py-24">
        <div className="text-center mb-12">
          <p className="text-brand-700 font-semibold text-sm mb-3">よくあるご質問</p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">FAQ</h2>
        </div>
        <div className="space-y-3">
          {FAQS.map((item) => (
            <details
              key={item.q}
              className="group rounded-xl border border-slate-200 bg-white px-5 py-4 [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex items-center justify-between gap-4 cursor-pointer list-none font-semibold text-slate-900">
                <span>{item.q}</span>
                <ChevronDown className="w-5 h-5 text-slate-400 shrink-0 transition-transform group-open:rotate-180" />
              </summary>
              <p className="text-slate-600 text-sm leading-relaxed mt-3">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

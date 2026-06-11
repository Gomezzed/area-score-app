import { LogIn, Search, MapPinned, FileText } from 'lucide-react'

// ⑥ How it works（ライト）
//   ログイン → エリア検索 → スコア・地図確認 → レポート出力
const STEPS = [
  { icon: LogIn, title: 'ログイン', body: 'メールまたはGoogleアカウントで数秒で開始。' },
  { icon: Search, title: 'エリア検索', body: '地方・都道府県・市区町村を選んで対象エリアを絞り込み。' },
  { icon: MapPinned, title: 'スコア・地図確認', body: 'エリアスコアとヒートマップ、各種データを確認。' },
  { icon: FileText, title: 'レポート出力', body: 'PDF・CSVで出力し、提案や社内共有にそのまま活用。' },
]

export function HowItWorks() {
  return (
    <section className="bg-slate-50 text-slate-900">
      <div className="max-w-6xl mx-auto px-4 py-20 sm:py-24">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <p className="text-blue-600 font-semibold text-sm mb-3">使い方</p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
            登録から出力まで、4ステップ。
          </h2>
        </div>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <div key={s.title} className="relative text-center">
              <div className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white border border-slate-200 mb-5">
                <s.icon className="w-7 h-7 text-blue-600" />
                <span className="absolute -top-2 -right-2 w-6 h-6 bg-blue-600 text-white rounded-full text-xs font-bold flex items-center justify-center">
                  {i + 1}
                </span>
              </div>
              <h3 className="text-base font-bold mb-2">{s.title}</h3>
              <p className="text-slate-600 text-sm max-w-xs mx-auto leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

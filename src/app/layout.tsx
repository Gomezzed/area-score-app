import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'エリアスコア | 不動産仲介向けエリア分析SaaS',
  description:
    '人口動態と不動産取引データを掛け合わせて、エリアの集客ポテンシャルを100点満点でスコア化。不動産仲介・Web広告の優先順位をデータで決める。',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className="h-full">
      <head>
        {/* Leaflet CSS をグローバルに1回だけ読み込む */}
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          crossOrigin=""
        />
      </head>
      <body className="h-full bg-slate-900 antialiased">{children}</body>
    </html>
  )
}

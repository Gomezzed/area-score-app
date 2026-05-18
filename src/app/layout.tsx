import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'エリアスコア分析ダッシュボード',
  description: '都市エリアのスコアリング・分析ツール',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className="h-full">
      <body className="h-full bg-slate-900 antialiased">{children}</body>
    </html>
  )
}

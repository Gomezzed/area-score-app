import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'エリアスコア分析ダッシュボード',
  description: '都市エリアのスコアリング・分析ツール',
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

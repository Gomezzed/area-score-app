import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'AreaScore 分析ダッシュボード',
  description: '都市エリアのスコアリング・分析ツール',
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

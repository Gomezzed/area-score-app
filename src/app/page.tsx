import type { Metadata } from 'next'
import { LandingHeader } from '@/components/landing/LandingHeader'
import { Hero } from '@/components/marketing/Hero'
import { Problem } from '@/components/marketing/Problem'
import { Solution } from '@/components/marketing/Solution'
import { Features } from '@/components/marketing/Features'
import { HowItWorks } from '@/components/marketing/HowItWorks'
import { UseCases } from '@/components/marketing/UseCases'
import { Pricing } from '@/components/marketing/Pricing'
import { FAQ } from '@/components/marketing/FAQ'
import { ContactForm } from '@/components/marketing/ContactForm'
import { Footer } from '@/components/marketing/Footer'

const title = 'エリアスコア ｜「どのエリアで媒介を取るか」を、勘ではなく数字で決める。'
const description =
  '人口動態 × 駅乗降客数 × 不動産取引データをエリアスコアで可視化。営業エリアの意思決定を30分→5分に短縮する、不動産・マーケティング向け地域分析SaaS。クローズドβ受付中。'

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    type: 'website',
    locale: 'ja_JP',
    siteName: 'エリアスコア',
    // TODO(PO): public/lp/ogp.png（1200×630推奨）を用意して images に設定
    // images: [{ url: '/lp/ogp.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
  },
}

export default function LandingPage() {
  return (
    <main className="bg-white">
      <LandingHeader />
      <Hero />
      <Problem />
      <Solution />
      <Features />
      <HowItWorks />
      <UseCases />
      <Pricing />
      <FAQ />
      <ContactForm />
      <Footer />
    </main>
  )
}

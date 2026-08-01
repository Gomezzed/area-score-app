import type { Metadata } from 'next'
import { LandingHeader } from '@/components/landing/LandingHeader'
import { ContactForm } from '@/components/marketing/ContactForm'
import { Footer } from '@/components/marketing/Footer'

const title = 'デモ・導入相談 | AreaScore'
const description = 'Platinum プランの導入相談・デモのお申し込みはこちら。営業効率を3倍に短縮する不動産仲介向けAI分析SaaS。'

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    type: 'website',
    locale: 'ja_JP',
    siteName: 'AreaScore',
  },
  twitter: {
    card: 'summary',
    title,
    description,
  },
}

export default function ContactPage() {
  return (
    <main className="bg-white">
      <LandingHeader />

      <section className="bg-page-bg text-slate-900 py-16 sm:py-24 border-b border-slate-200">
        <div className="max-w-2xl mx-auto px-4 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            Platinum プラン
          </h1>
          <p className="text-xl text-brand-700 mb-2">
            デモ・導入相談
          </p>
          <p className="text-slate-500 max-w-xl mx-auto">
            エリア比較、商圏レポート、アラート機能を含む包括的なソリューション。
            デモや導入についてのご相談は、下記フォームからお気軽にお問い合わせください。
          </p>
        </div>
      </section>

      <section className="py-16 sm:py-24 bg-white">
        <div className="max-w-2xl mx-auto px-4">
          <ContactForm />
        </div>
      </section>

      <section className="bg-slate-50 py-16 sm:py-24">
        <div className="max-w-2xl mx-auto px-4">
          <h2 className="text-2xl font-bold text-center mb-12">よくあるご質問</h2>
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 mb-2">
                導入までのフローは？
              </h3>
              <p className="text-slate-600">
                お問い合わせ後、営業担当者がデモンストレーションとご要望のヒアリングを行います。
                その後、導入スケジュール・カスタマイズ内容をご相談させていただきます。
              </p>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 mb-2">
                既存システムとの連携は可能？
              </h3>
              <p className="text-slate-600">
                Salesforce・HubSpot等との連携に対応しています。ご利用中のシステムについてお聞きし、
                最適な連携方法をご提案させていただきます。
              </p>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 mb-2">
                トレーニング・サポートは含まれる？
              </h3>
              <p className="text-slate-600">
                Platinum プランには専任サポート（Slack/Zoom）とオンボーディングトレーニングが含まれます。
                導入後もご不明な点があればいつでもお気軽にお問い合わせください。
              </p>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  )
}

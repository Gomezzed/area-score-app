import type { Metadata } from 'next'
import { LegalShell, LegalHeading, LegalParagraph } from '@/components/legal/LegalShell'

export const metadata: Metadata = {
  title: 'プライバシーポリシー ｜ エリアスコア',
  description: 'エリアスコアのプライバシーポリシー',
}

const ol = 'list-decimal pl-5 space-y-1.5 text-[15px] text-slate-700 leading-relaxed mt-2'
const ul = 'list-disc pl-5 space-y-1.5 text-[15px] text-slate-700 leading-relaxed mt-2'

export default function PrivacyPage() {
  return (
    <LegalShell title="プライバシーポリシー" established="2026年6月11日 制定">
      <LegalParagraph>
        Crouch Boost（以下「当方」といいます）は、当方が提供する地域分析サービス「エリアスコア」（以下「本サービス」といいます）における利用者の個人情報の取扱いについて、以下のとおりプライバシーポリシーを定めます。
      </LegalParagraph>

      <section>
        <LegalHeading>第1条（取得する情報）</LegalHeading>
        <LegalParagraph>当方は、本サービスの提供にあたり、以下の情報を取得します。</LegalParagraph>
        <ol className={ol}>
          <li>アカウント情報: メールアドレス、認証情報（Google アカウント連携を利用する場合は Google が提供する基本プロフィール情報を含む）</li>
          <li>決済情報: 契約プラン、決済履歴（クレジットカード番号は決済代行会社 Stripe, Inc. が保持し、当方は保持しません）</li>
          <li>お問い合わせ情報: 会社名、担当者名、メールアドレス、電話番号、お問い合わせ内容</li>
          <li>利用状況に関する情報: アクセスログ、Cookie、利用端末・ブラウザに関する情報</li>
        </ol>
      </section>

      <section>
        <LegalHeading>第2条（利用目的）</LegalHeading>
        <LegalParagraph>取得した情報は、以下の目的で利用します。</LegalParagraph>
        <ol className={ol}>
          <li>本サービスの提供、本人確認、認証のため</li>
          <li>利用料金の請求・決済のため</li>
          <li>お問い合わせへの対応のため</li>
          <li>本サービスの改善、新機能の開発、利用状況の分析のため</li>
          <li>重要なお知らせ（規約変更・メンテナンス等）の通知のため</li>
        </ol>
      </section>

      <section>
        <LegalHeading>第3条（第三者提供）</LegalHeading>
        <LegalParagraph>
          当方は、法令に基づく場合を除き、本人の同意なく個人情報を第三者に提供しません。
        </LegalParagraph>
      </section>

      <section>
        <LegalHeading>第4条（外部サービスの利用）</LegalHeading>
        <LegalParagraph>
          当方は、本サービスの提供にあたり以下の外部サービスを利用しており、各サービスの提供者に必要な範囲で情報が送信されます。
        </LegalParagraph>
        <ul className={ul}>
          <li>Supabase Inc.（データベース・認証基盤）</li>
          <li>Stripe, Inc.（決済処理）</li>
          <li>Vercel Inc.（ホスティング）</li>
          <li>Resend（メール通知）</li>
          <li>Google LLC（Google アカウント認証を利用する場合）</li>
        </ul>
      </section>

      <section>
        <LegalHeading>第5条（安全管理措置）</LegalHeading>
        <LegalParagraph>
          当方は、個人情報の漏えい、滅失または毀損の防止のため、アクセス制御・通信の暗号化等、必要かつ適切な安全管理措置を講じます。
        </LegalParagraph>
      </section>

      <section>
        <LegalHeading>第6条（開示・訂正・削除）</LegalHeading>
        <LegalParagraph>
          利用者は、当方の保有する自己の個人情報について、開示・訂正・利用停止・削除を請求することができます。ご希望の場合は第8条の窓口までご連絡ください。
        </LegalParagraph>
      </section>

      <section>
        <LegalHeading>第7条（ポリシーの変更）</LegalHeading>
        <LegalParagraph>
          本ポリシーの内容は、法令の改正やサービス内容の変更に応じて、利用者に通知することなく変更されることがあります。変更後のポリシーは、本サービス上に掲載した時点から効力を生じます。
        </LegalParagraph>
      </section>

      <section>
        <LegalHeading>第8条（お問い合わせ窓口）</LegalHeading>
        <LegalParagraph>
          本ポリシーに関するお問い合わせは、下記までお願いいたします。
        </LegalParagraph>
        <div className="text-[15px] text-slate-700 leading-relaxed mt-2">
          <p>事業者名: Crouch Boost　運営責任者: 村上 里輝</p>
          <p>メールアドレス: info@crouchingstyle.com</p>
        </div>
      </section>
    </LegalShell>
  )
}

import type { Metadata } from 'next'
import { LegalShell } from '@/components/legal/LegalShell'

export const metadata: Metadata = {
  title: '特定商取引法に基づく表記 ｜ エリアスコア',
  description: 'エリアスコアの特定商取引法に基づく表記',
}

const ROWS: { label: string; value: string }[] = [
  { label: '販売事業者', value: 'Crouch Boost（クラウチブースト）' },
  { label: '運営責任者', value: '村上 里輝' },
  {
    label: '所在地',
    value:
      '請求があった場合、遅滞なく開示いたします。開示をご希望の方は下記メールアドレスまでご連絡ください。',
  },
  {
    label: '電話番号',
    value:
      '請求があった場合、遅滞なく開示いたします。開示をご希望の方は下記メールアドレスまでご連絡ください。',
  },
  { label: 'メールアドレス', value: 'info@crouchingstyle.com' },
  {
    label: '販売価格',
    value:
      'Starterプラン: 月額30,000円（税抜）／Standardプラン: 月額50,000円（税抜）／Platinumプラン: 月額100,000円（税抜）。年額契約は各プラン月額の20%OFF。価格はすべて税抜表示であり、別途消費税がかかります。',
  },
  {
    label: '商品代金以外の必要料金',
    value: '消費税。インターネット接続にかかる通信料等はお客様のご負担となります。',
  },
  { label: '支払方法', value: 'クレジットカード決済（Stripe）' },
  {
    label: '支払時期',
    value:
      '初回: お申し込み時に決済。以降: 契約更新日に自動決済（月額契約は毎月、年額契約は毎年）。',
  },
  { label: 'サービスの提供時期', value: '決済完了後、直ちにご利用いただけます。' },
  {
    label: '解約について',
    value:
      'アカウント設定内のカスタマーポータル（Stripe Customer Portal）より、いつでも解約手続きが可能です。解約後も、当該請求期間の末日までサービスをご利用いただけます。',
  },
  {
    label: '返金について',
    value: '役務の性質上、サービス提供開始後の返品・返金（日割り返金を含む）には対応しておりません。',
  },
  { label: '動作環境', value: '最新版の Google Chrome / Safari / Microsoft Edge を推奨します。' },
]

export default function TokushohoPage() {
  return (
    <LegalShell title="特定商取引法に基づく表記">
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full table-fixed border-collapse text-[15px]">
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className="border-b border-slate-200 last:border-b-0 align-top">
                <th className="w-28 sm:w-48 bg-slate-50 text-left font-semibold text-slate-700 px-3 sm:px-4 py-3 break-words">
                  {row.label}
                </th>
                <td className="text-slate-700 px-3 sm:px-4 py-3 leading-relaxed break-words">
                  {row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LegalShell>
  )
}

import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import CustomersClient from './CustomersClient'

export const metadata: Metadata = {
  title: '顧客アタックリスト | AreaScore',
  description: '自社の反響顧客名簿を町域の仕入れ優先度で並べ替えるアタックリスト',
}

// /customers は NEXT_PUBLIC_FEATURE_CUSTOMER_LIST=true のときのみ描画する。
//   フラグ off ではページの存在ごと 404（サーバー側 API の FEATURE_CUSTOMER_LIST と
//   合わせて UI/API の二層で封鎖する。H9 の教訓）。
export default function CustomersPage() {
  if (process.env.NEXT_PUBLIC_FEATURE_CUSTOMER_LIST !== 'true') {
    notFound()
  }
  return <CustomersClient />
}

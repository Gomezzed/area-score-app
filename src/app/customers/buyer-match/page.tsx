'use client'

// =====================================================================
// PR-BM-9b-2: 購入希望マッチ 匿名カードの専用画面（裁定77・①B案）。
//   /customers/buyer-match?list=<UUID>&muni_code_5=&property_type=&price_min=&price_max=
//   - 状態は URL クエリで持つ（裁定69→77・条件はクエリで渡す。⛔ 画面で再入力させない）。
//   - 二層封鎖は /customers/map と逐語で同一（裁定79）:
//       上層 = NEXT_PUBLIC_FEATURE_CUSTOMER_LIST（off ならページごと 404）
//       下層 = canUse(plan,'townAcquisitionPriority')（未達はアップセル）
//     ⛔ 新しいゲート機構を作らない・⛔ plans.ts を触らない。
//     ⚠ cards API 側のガード（isCustomerListEnabled/isBuyerMatchEnabled/guardFeature）と
//       二重になるが、これは /customers/map と同じ構造で正しい（画面と API の両方で塞ぐ）。
//   - データ取得は自分で cards API を1回呼ぶ（売主向けシートと合わせ2回呼ばれ得る・許容）。
//   - 見出しは used_conditions から組む（裁定73）。カード領域は suppressed / stage=null で
//     出さない（裁定72・⛔ cards.length で判定しない）。
// =====================================================================

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { notFound, useSearchParams } from 'next/navigation'
import { ArrowLeft, Loader2, Lock } from 'lucide-react'
import { useSubscription } from '@/hooks/useSubscription'
import { canUse } from '@/lib/plans'
import { BUYER_MATCH_CARDS_MESSAGES, BUYER_MATCH_MESSAGES } from '@/lib/buyer-match/messages'
import { buildBuyerMatchQueryString, parsePriceInput } from '@/lib/buyer-match/request'
import {
  buildBuyerCardsHeading,
  formatCountValue,
  shouldShowBuyerCards,
} from '@/lib/buyer-match/display'
import {
  fetchBuyerMatchCards,
  fetchCustomerListAreas,
  fetchPropertyTypes,
} from '@/lib/buyer-match/client'
import type { BuyerMatchCards } from '@/lib/buyer-match/types'
import { BuyerMatchCardsView } from '@/components/ui/BuyerMatchCardsView'

// UI/API の二層封鎖の上層（/customers/page.tsx・/customers/map と同一の環境フラグ）。
const FEATURE_ON = process.env.NEXT_PUBLIC_FEATURE_CUSTOMER_LIST === 'true'

type Load<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'failed' }
  | { status: 'unavailable' }

function FullPageLoading() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-400">
      <Loader2 className="w-4 h-4 animate-spin mr-2" />
      読み込み中…
    </div>
  )
}

function BackLink() {
  return (
    <Link
      href="/customers"
      className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
    >
      <ArrowLeft className="w-4 h-4" />
      顧客名簿へ戻る
    </Link>
  )
}

// プラン未達（Platinum 未満）のアップセル。判定は canUse(plan,'townAcquisitionPriority') のまま。
//   ⛔ /customers/map と同一。新しい判定ロジックを書き起こさない（裁定79）。
function UpsellBlock() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 mb-3">
        <Lock className="w-4 h-4 text-brand-700" />
        この機能は Platinum プランでご利用いただけます
      </div>
      <Link
        href="/pricing"
        className="inline-block text-sm font-semibold text-brand-700 hover:text-brand-500 transition-colors"
      >
        プランを見る
      </Link>
    </div>
  )
}

export default function BuyerMatchCardsPage() {
  // 上層封鎖：フラグ off ならページの存在ごと 404（/customers/map と同一）。
  if (!FEATURE_ON) notFound()
  return (
    <Suspense fallback={<FullPageLoading />}>
      <PageInner />
    </Suspense>
  )
}

function PageInner() {
  const sp = useSearchParams()
  const list = sp.get('list')
  const muniCode5 = sp.get('muni_code_5')
  const propertyType = sp.get('property_type')
  const priceMin = parsePriceInput(sp.get('price_min') ?? '')
  const priceMax = parsePriceInput(sp.get('price_max') ?? '')

  // 下層封鎖：プラン判定（/customers/map と同一のキー）。
  const { plan, isLoading: planLoading } = useSubscription()
  const allowed = canUse(plan, 'townAcquisitionPriority')

  if (planLoading) return <FullPageLoading />
  if (!allowed) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <BackLink />
        </div>
        <UpsellBlock />
      </div>
    )
  }
  if (!list) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
          <BackLink />
          <p className="text-sm text-slate-500">顧客名簿が指定されていません。</p>
        </div>
      </div>
    )
  }

  // 条件が変わったら再マウントして state を初期化（effect 内の同期 setState を避ける）。
  const cardsKey = `${muniCode5 ?? ''}:${propertyType ?? ''}:${priceMin ?? ''}:${priceMax ?? ''}`
  return (
    <CardsRoute
      key={cardsKey}
      list={list}
      muniCode5={muniCode5}
      propertyType={propertyType}
      priceMin={priceMin}
      priceMax={priceMax}
    />
  )
}

function CardsRoute({
  list,
  muniCode5,
  propertyType,
  priceMin,
  priceMax,
}: {
  list: string
  muniCode5: string | null
  propertyType: string | null
  priceMin: number | null
  priceMax: number | null
}) {
  const [cardsLoad, setCardsLoad] = useState<Load<BuyerMatchCards>>({ status: 'loading' })
  // property_type code → label_ja（バッジ・見出しの種別解決用）。null=読み込み中。
  const [labelByCode, setLabelByCode] = useState<Record<string, string> | null>(null)
  // muni_code_5 → muni_name（段4 見出しの市区町村名解決用）。null=読み込み中。
  const [muniNameByCode, setMuniNameByCode] = useState<Record<string, string> | null>(null)

  // cards の条件クエリ（⛔ 別のクエリ組立を作らない・裁定80。buildBuyerMatchQueryString 流用）。
  const query = useMemo(
    () => buildBuyerMatchQueryString({ muniCode5, propertyType, priceMin, priceMax }),
    [muniCode5, propertyType, priceMin, priceMax],
  )

  useEffect(() => {
    let alive = true
    ;(async () => {
      const res = await fetchBuyerMatchCards(list, query)
      if (!alive) return
      if (res.ok) {
        setCardsLoad({ status: 'ready', data: res.data })
      } else {
        setCardsLoad({ status: res.reason === 'unavailable' ? 'unavailable' : 'failed' })
      }
    })()
    return () => {
      alive = false
    }
  }, [list, query])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const res = await fetchPropertyTypes()
      if (!alive) return
      const map: Record<string, string> = {}
      if (res.ok) for (const t of res.data) map[t.code] = t.label_ja
      setLabelByCode(map)
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const res = await fetchCustomerListAreas(list)
      if (!alive) return
      const map: Record<string, string> = {}
      if (res.ok) for (const a of res.data) map[a.muni_code_5] = a.muni_name
      setMuniNameByCode(map)
    })()
    return () => {
      alive = false
    }
  }, [list])

  // 404（FEATURE_CUSTOMER_LIST off／FEATURE_BUYER_MATCH off／名簿なし）は存在ごと隠す。
  if (cardsLoad.status === 'unavailable') notFound()

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <BackLink />

        {cardsLoad.status === 'loading' || labelByCode === null || muniNameByCode === null ? (
          <FullPageLoading />
        ) : cardsLoad.status === 'failed' ? (
          <p className="text-sm text-slate-500">購入検討者の情報を取得できませんでした。</p>
        ) : (
          <>
            <CardsBody cards={cardsLoad.data} labelByCode={labelByCode} muniNameByCode={muniNameByCode} />
            {/* 免責（裁定30/82・逐語）。カード一覧でも抑止文言だけの経路でも必ず1つ置く。
                ⛔ disclaimer 定数は編集しない・新設しない（参照のみ）。*/}
            <p className="text-xs text-slate-400 leading-relaxed">{BUYER_MATCH_MESSAGES.disclaimer}</p>
          </>
        )}
      </div>
    </div>
  )
}

function CardsBody({
  cards,
  labelByCode,
  muniNameByCode,
}: {
  cards: BuyerMatchCards
  labelByCode: Record<string, string>
  muniNameByCode: Record<string, string>
}) {
  // 裁定72: suppressed=true / stage=null はカード領域ごと出さず、抑止文言を出す。
  //   ⛔ cards.length で判定しない（display.ts の shouldShowBuyerCards が担保）。
  if (!shouldShowBuyerCards(cards)) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-6 py-8 text-center text-sm text-slate-500">
        {BUYER_MATCH_CARDS_MESSAGES.suppressed}
      </div>
    )
  }

  const used = cards.used_conditions
  // 見出しは used_conditions 由来（裁定73）。種別/市区町村名を解決して純関数へ渡す。
  const heading = used
    ? buildBuyerCardsHeading(
        used,
        used.property_type ? labelByCode[used.property_type] ?? null : null,
        used.muni_code_5 ? muniNameByCode[used.muni_code_5] ?? null : null,
      )
    : ''

  return (
    <BuyerMatchCardsView
      heading={heading}
      countLabel={formatCountValue(cards.matched_count)}
      cards={cards.cards}
      labelByCode={labelByCode}
    />
  )
}

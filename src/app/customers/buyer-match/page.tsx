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
import { notFound, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Loader2, Lock } from 'lucide-react'
import { useSubscription } from '@/hooks/useSubscription'
import { canUse } from '@/lib/plans'
import {
  BUYER_MATCH_CARDS_MESSAGES,
  BUYER_MATCH_MESSAGES,
  BUYER_MATCH_ORG_MESSAGES,
} from '@/lib/buyer-match/messages'
import {
  buildBuyerMatchQueryString,
  buildEditHref,
  buildPresentHref,
  isPresentMode,
  parsePriceInput,
} from '@/lib/buyer-match/request'
import {
  buildBuyerCardsHeading,
  buildCountDisplays,
  formatAreaLabel,
  formatConditionSummary,
  formatCountValue,
  shouldShowBuyerCards,
  type CountDisplay,
} from '@/lib/buyer-match/display'
import {
  fetchBuyerMatchCards,
  fetchCustomerListAreas,
  fetchOrgBuyerMatchCards,
  fetchOrgBuyerMatchSummary,
  fetchOrgBuyerMatchAreas,
  fetchPropertyTypes,
  type CustomerListArea,
} from '@/lib/buyer-match/client'
import type { BuyerMatchCards, BuyerMatchSummary, PropertyTypeOption } from '@/lib/buyer-match/types'
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
      {BUYER_MATCH_ORG_MESSAGES.backToCustomers}
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
  // 裁定-bm-C: list なし＝org モード（全名簿合算・本 PR 新設）。
  //   ⛔ list あり＝名簿モードは1ビットも変えない（下の CardsRoute へ）。
  if (!list) {
    return <OrgMode />
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

// =====================================================================
// PR-BM-10c: org モード（?list なし・裁定-bm-C/D）。
//   条件フォーム（市区町村・物件種別・価格帯）→ 「表示する」で URL クエリを更新
//   （⛔ list を付けない・条件5）→ URL 由来で全名簿合算の summary（上段）と
//   cards（下段）を並列取得する。URL に条件があれば初期表示で自動取得。
//   ・上段＝summary（wide/near・裁定-bm-D）。⛔ near/wide 見出しは既存流用（裁定41）。
//   ・下段＝既存 CardsBody を再利用（⛔ 複製しない）。見出しは buildBuyerCardsHeading、
//     件数は matched_count（名簿モードと同じ整形・条件6）。
//   ・校区セレクトは置かない（裁定86・p_school_district_id は null 固定）。
//   ・ゲート（FEATURE_ON→notFound / canUse→Upsell）は PageInner で通過済み。
//     API 404→unavailable→notFound・403→Upsell（canUse が先に弾く）に写す（条件5）。
// =====================================================================

const ORG_SELECT_CLASS =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500'
const ORG_INPUT_CLASS = ORG_SELECT_CLASS
const ORG_LABEL_CLASS = 'block mb-1 text-xs font-medium text-slate-500'

function OrgMode() {
  const router = useRouter()
  const sp = useSearchParams()

  // 選択肢：市区町村＝org 版 areas（全名簿の全市区町村・案イ）／物件種別＝マスタ（裁定19/35）。
  const [areas, setAreas] = useState<Load<CustomerListArea[]>>({ status: 'loading' })
  const [types, setTypes] = useState<Load<PropertyTypeOption[]>>({ status: 'loading' })

  useEffect(() => {
    let alive = true
    ;(async () => {
      // 校区セレクトは置かないが、areas は elementary 索引を候補に使う（裁定案イ）。
      const res = await fetchOrgBuyerMatchAreas('elementary')
      if (!alive) return
      setAreas(
        res.ok
          ? { status: 'ready', data: res.data }
          : { status: res.reason === 'unavailable' ? 'unavailable' : 'failed' },
      )
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const res = await fetchPropertyTypes()
      if (!alive) return
      setTypes(res.ok ? { status: 'ready', data: res.data } : { status: 'failed' })
    })()
    return () => {
      alive = false
    }
  }, [])

  const areaList = useMemo(() => (areas.status === 'ready' ? areas.data : []), [areas])
  const typeList = useMemo(() => (types.status === 'ready' ? types.data : []), [types])

  // code→label_ja／muni_code_5→muni_name（上段の条件要約・下段の見出し解決用）。
  const labelByCode = useMemo(() => {
    const m: Record<string, string> = {}
    for (const t of typeList) m[t.code] = t.label_ja
    return m
  }, [typeList])
  const muniNameByCode = useMemo(() => {
    const m: Record<string, string> = {}
    for (const a of areaList) m[a.muni_code_5] = a.muni_name
    return m
  }, [areaList])

  // フォームの選択（URL の現条件で初期化。null＝未選択で既定は先頭を採る）。
  const [muniChoice, setMuniChoice] = useState<string | null>(sp.get('muni_code_5'))
  const [typeChoice, setTypeChoice] = useState<string | null>(sp.get('property_type'))
  const [priceMinInput, setPriceMinInput] = useState(sp.get('price_min') ?? '')
  const [priceMaxInput, setPriceMaxInput] = useState(sp.get('price_max') ?? '')

  // 既定は「選択が無ければ先頭」。effect 内の同期 setState を避け派生値で解決（Panel と同法）。
  const muniCode5 = useMemo(() => {
    if (muniChoice && areaList.some((a) => a.muni_code_5 === muniChoice)) return muniChoice
    return areaList[0]?.muni_code_5 ?? null
  }, [muniChoice, areaList])
  const propertyType = useMemo(() => {
    if (typeChoice && typeList.some((t) => t.code === typeChoice)) return typeChoice
    return typeList[0]?.code ?? null
  }, [typeChoice, typeList])

  const priceMin = parsePriceInput(priceMinInput)
  const priceMax = parsePriceInput(priceMaxInput)
  // 下限>上限は成り立たない。価格条件を落として送る（400 を踏まない・Panel と同法）。
  const priceInverted = priceMin !== null && priceMax !== null && priceMin > priceMax

  // 「表示する」→ URL クエリを更新（muni_code_5/property_type/price_min/price_max・⛔ list なし）。
  //   ⛔ 別のクエリ組立を作らない（buildBuyerMatchQueryString 流用・裁定80）。
  function handleSubmit() {
    if (!muniCode5 || !propertyType) return
    const query = buildBuyerMatchQueryString({
      muniCode5,
      propertyType,
      priceMin: priceInverted ? null : priceMin,
      priceMax: priceInverted ? null : priceMax,
    })
    router.replace(`/customers/buyer-match${query ? `?${query}` : ''}`)
  }

  // URL の現条件（結果表示のトリガ。form の選択とは独立に URL を正とする）。
  const urlMuni = sp.get('muni_code_5')
  const urlType = sp.get('property_type')
  const urlPriceMin = parsePriceInput(sp.get('price_min') ?? '')
  const urlPriceMax = parsePriceInput(sp.get('price_max') ?? '')
  const activeQuery = useMemo(
    () =>
      buildBuyerMatchQueryString({
        muniCode5: urlMuni,
        propertyType: urlType,
        priceMin: urlPriceMin,
        priceMax: urlPriceMax,
      }),
    [urlMuni, urlType, urlPriceMin, urlPriceMax],
  )
  const hasConditions = !!urlMuni && !!urlType
  const formReady = areas.status !== 'loading' && types.status !== 'loading'

  // org 版 areas が 404（FEATURE_BUYER_MATCH off／機能なし）＝ページごと隠す（裁定-bm-G）。
  if (areas.status === 'unavailable') notFound()

  // 提示モード（?present=1・仮番 -bm-M・裁定86「売主が触れる画面に入力欄を置かない」）。
  //   条件が解決できるとき（URL 条件あり・areas/types 取得済みかつ非空）だけ入る。
  //   あわせて URL の市区町村・種別がマスタ（areas/property_types）で解決できること。
  //   満たさなければ present を無視して編集モードで描画する（新しい空状態は作らない）。
  //   ⚠ 表示の切替であり権限の境界ではない（ゲートは PageInner・API 側のまま）。
  //   ⛔ CSS で隠さない（原則12）。フォームと BackLink は JSX ごと描画しない。
  const canPresent =
    hasConditions &&
    formReady &&
    areas.status === 'ready' &&
    areaList.length > 0 &&
    types.status === 'ready' &&
    typeList.length > 0 &&
    !!urlMuni &&
    Object.hasOwn(muniNameByCode, urlMuni) &&
    !!urlType &&
    Object.hasOwn(labelByCode, urlType)
  const present = isPresentMode(sp) && canPresent
  const urlConditions = {
    muniCode5: urlMuni,
    propertyType: urlType,
    priceMin: urlPriceMin,
    priceMax: urlPriceMax,
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* 提示モードでは戻るリンク（社内導線）を DOM に出さない（仮番 -bm-M）。*/}
        {!present && <BackLink />}

        {/* 条件フォーム（営業担当が操作）。⛔ 校区セレクトは置かない（裁定86）。*/}
        {!present && (
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            {!formReady ? (
              <div className="flex items-center gap-2 px-1 py-6 text-sm text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                読み込み中…
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {/* 市区町村（org 版 areas の索引・必須） */}
                  <div>
                    <label className={ORG_LABEL_CLASS} htmlFor="org-muni">
                      市区町村
                    </label>
                    {areas.status === 'failed' ? (
                      <p className="text-sm text-slate-400">市区町村を取得できませんでした</p>
                    ) : areaList.length === 0 ? (
                      <p className="text-sm text-slate-400">{BUYER_MATCH_ORG_MESSAGES.orgAreasEmpty}</p>
                    ) : (
                      <select
                        id="org-muni"
                        className={ORG_SELECT_CLASS}
                        value={muniCode5 ?? ''}
                        onChange={(e) => setMuniChoice(e.target.value)}
                      >
                        {areaList.map((a) => (
                          <option key={a.muni_code_5} value={a.muni_code_5}>
                            {formatAreaLabel(a)}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* 物件種別（property_types・必須・⛔ ラベル直書き禁止） */}
                  <div>
                    <label className={ORG_LABEL_CLASS} htmlFor="org-type">
                      物件種別
                    </label>
                    {types.status === 'failed' || typeList.length === 0 ? (
                      <p className="text-sm text-slate-400">{BUYER_MATCH_MESSAGES.propertyTypesFailed}</p>
                    ) : (
                      <select
                        id="org-type"
                        className={ORG_SELECT_CLASS}
                        value={propertyType ?? ''}
                        onChange={(e) => setTypeChoice(e.target.value)}
                      >
                        {typeList.map((t) => (
                          <option key={t.code} value={t.code}>
                            {t.label_ja}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* 価格帯（万円・任意・片側のみ可） */}
                  <div>
                    <label className={ORG_LABEL_CLASS} htmlFor="org-price-min">
                      価格の下限（万円）
                    </label>
                    <input
                      id="org-price-min"
                      className={ORG_INPUT_CLASS}
                      inputMode="numeric"
                      placeholder="例: 2000"
                      value={priceMinInput}
                      onChange={(e) => setPriceMinInput(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={ORG_LABEL_CLASS} htmlFor="org-price-max">
                      価格の上限（万円）
                    </label>
                    <input
                      id="org-price-max"
                      className={ORG_INPUT_CLASS}
                      inputMode="numeric"
                      placeholder="例: 4000"
                      value={priceMaxInput}
                      onChange={(e) => setPriceMaxInput(e.target.value)}
                    />
                  </div>
                </div>

                {priceInverted && (
                  <p className="mt-2 text-xs text-amber-700">
                    価格の下限が上限を上回っています。価格の条件は反映していません。
                  </p>
                )}

                <div className="mt-3">
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!muniCode5 || !propertyType}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-700 hover:bg-brand-500 disabled:bg-slate-300 text-white text-sm font-medium transition-colors"
                  >
                    {BUYER_MATCH_ORG_MESSAGES.orgSubmit}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* 編集モード：条件が解決できるときだけ「提示する」（現在の4条件＋present=1・仮番 -bm-M）。*/}
        {!present && canPresent && (
          <div className="flex justify-end">
            <Link
              href={buildPresentHref(urlConditions)}
              className="inline-flex items-center rounded-lg border border-brand-700 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100 transition-colors"
            >
              {BUYER_MATCH_ORG_MESSAGES.presentButton}
            </Link>
          </div>
        )}

        {/* 上段（summary）＋下段（cards）。URL に条件があれば表示、無ければ案内（裁定-bm-L）。*/}
        {formReady &&
          (hasConditions ? (
            <OrgResults
              key={activeQuery}
              query={activeQuery}
              muniName={urlMuni ? muniNameByCode[urlMuni] ?? null : null}
              propertyTypeLabel={urlType ? labelByCode[urlType] ?? null : null}
              priceMin={urlPriceMin}
              priceMax={urlPriceMax}
              labelByCode={labelByCode}
              muniNameByCode={muniNameByCode}
            />
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-8 text-center text-sm text-slate-500">
              {BUYER_MATCH_ORG_MESSAGES.orgEmpty}
            </div>
          ))}

        {/* 提示モード：結果の下・右寄せに「編集に戻る」（4条件を保ち present なし・仮番 -bm-M）。*/}
        {present && (
          <div className="flex justify-end">
            <Link
              href={buildEditHref(urlConditions)}
              className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
            >
              {BUYER_MATCH_ORG_MESSAGES.presentBackToEdit}
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

function OrgResults({
  query,
  muniName,
  propertyTypeLabel,
  priceMin,
  priceMax,
  labelByCode,
  muniNameByCode,
}: {
  query: string
  muniName: string | null
  propertyTypeLabel: string | null
  priceMin: number | null
  priceMax: number | null
  labelByCode: Record<string, string>
  muniNameByCode: Record<string, string>
}) {
  const [load, setLoad] = useState<Load<{ summary: BuyerMatchSummary; cards: BuyerMatchCards }>>({
    status: 'loading',
  })

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [s, c] = await Promise.all([
        fetchOrgBuyerMatchSummary(query),
        fetchOrgBuyerMatchCards(query),
      ])
      if (!alive) return
      // どちらかが 404 ＝ FEATURE_BUYER_MATCH off／機能なし。存在ごと隠す（裁定-bm-G）。
      if ((!s.ok && s.reason === 'unavailable') || (!c.ok && c.reason === 'unavailable')) {
        setLoad({ status: 'unavailable' })
        return
      }
      if (!s.ok || !c.ok) {
        setLoad({ status: 'failed' })
        return
      }
      setLoad({ status: 'ready', data: { summary: s.data, cards: c.data } })
    })()
    return () => {
      alive = false
    }
  }, [query])

  // 404（機能 off／名簿なし）は存在ごと隠す（名簿モードと同じ写し方・条件5）。
  if (load.status === 'unavailable') notFound()
  if (load.status === 'loading') return <FullPageLoading />
  if (load.status === 'failed') {
    return <p className="text-sm text-slate-500">購入検討者の情報を取得できませんでした。</p>
  }

  const { summary, cards } = load.data
  // 上段の2つの数（wide/near）。⛔ near/wide 見出しは既存流用（buildCountDisplays が担う）。
  const counts = buildCountDisplays(summary)
  const conditionSummary = formatConditionSummary({ muniName, propertyTypeLabel, priceMin, priceMax })

  return (
    <>
      {/* 上段（条件ボックス）。大きな数字＝wide／小さな数字＝near（抑止時は既存文言）。*/}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
        <p className="text-sm font-semibold text-slate-700">{BUYER_MATCH_ORG_MESSAGES.orgHeading}</p>
        <p className="mt-1 text-xs text-slate-500">{conditionSummary}</p>
        <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-3">
          <OrgCount display={counts.wide} size="lg" />
          <OrgCount display={counts.near} size="sm" />
        </div>
        {/* 免責（裁定34・逐語・既存定数の再掲）。⛔ disclaimer 定数は編集しない。*/}
        <p className="mt-3 text-xs text-slate-400 leading-relaxed">{BUYER_MATCH_MESSAGES.disclaimer}</p>
      </div>

      {/* 下段（既存カード描画 CardsBody を再利用・⛔ 複製しない・条件6）。*/}
      <CardsBody cards={cards} labelByCode={labelByCode} muniNameByCode={muniNameByCode} />
    </>
  )
}

// 上段の大きな数字1つ分。⛔ suppressed のとき数値を1つも描画しない（display.ts が value を
//   null にしているため、ここで組み立て直さない）。名簿モードの CountCard と同じ責務。
function OrgCount({ display, size }: { display: CountDisplay; size: 'lg' | 'sm' }) {
  const valueClass =
    size === 'lg' ? 'text-4xl font-bold text-slate-900' : 'text-2xl font-bold text-slate-700'
  return (
    <div>
      <p className="text-xs text-slate-500">{display.heading}</p>
      {display.value === null ? (
        <p className="mt-1 text-sm leading-relaxed text-slate-400">{display.message}</p>
      ) : (
        <p className={`mt-1 ${valueClass}`}>{formatCountValue(display.value)}</p>
      )}
    </div>
  )
}

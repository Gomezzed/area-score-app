'use client'

// =====================================================================
// PR-BM-7: 購入希望マッチ 売主向けパネル（顧客リスト詳細・裁定37 の位置）。
//   売主に見せる前提の集計だけを扱う。
//   ⛔ 個票を出さない。/buyer-match/rows はこのコンポーネントから呼ばない
//     （社内画面は本 PR の範囲外。client.ts に関数自体を置いていない）。
//   ⛔ unknown_area_count を出さない（k 抑止の対象外の生値・BM-4 裁定17）。
//   ⛔ 氏名・担当者・外部ID・住所・反響日を出さない。
//
//   【条件（裁定33・案A＝v1 は市区町村のみ）】
//     市区町村 … 名簿が当たった索引（GET /areas）から選ぶ
//     物件種別 … public.property_types（裁定35・⛔ ラベル直書き禁止）
//     査定価格 … 下限/上限（万円・任意）
//   校区セレクトは作らない。校区ランキング rows は k=5 抑止後の校区しか
//   含まないため、選択肢の有無自体が抑止状態を漏らす（request.ts のコメント）。
// =====================================================================

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, Download, Users } from 'lucide-react'
import { BUYER_MATCH_MESSAGES, BUYER_MATCH_CARDS_MESSAGES } from '@/lib/buyer-match/messages'
import { buildBuyerMatchQueryString, parsePriceInput } from '@/lib/buyer-match/request'
import {
  buildCellsDisplay,
  buildCountDisplays,
  formatCellCount,
  formatCellTitle,
  formatCountValue,
  shouldShowBuyerCardsButton,
  type CountDisplay,
} from '@/lib/buyer-match/display'
import {
  fetchBuyerMatchCards,
  fetchBuyerMatchCells,
  fetchBuyerMatchSummary,
  fetchCustomerListAreas,
  fetchPropertyTypes,
  type CustomerListArea,
} from '@/lib/buyer-match/client'
import type {
  BuyerMatchCards,
  BuyerMatchCell,
  BuyerMatchSummary,
  PropertyTypeOption,
} from '@/lib/buyer-match/types'
import { useSchoolDistrictMapPng } from '@/hooks/useSchoolDistrictMapPng'
import { buildLegendRows, type LegendRow } from '@/lib/heatmap-pdf/model'
import { TIER_LABEL, NO_DATA_LEGEND } from '@/lib/school-district-tiers'
import { TIER_FILL, NO_DATA_FILL } from '@/lib/school-district-map-style'
import { SCHOOL_DISTRICT_DISCLAIMER } from '@/lib/school-districts'

// 非同期取得の状態。'unavailable' は 404（機能なし／名簿なし）で、パネルごと出さない。
type Load<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'failed' }
  | { status: 'unavailable' }

// 集計の取得状態。key は取得時の条件（buildBuyerMatchQueryString の出力）。
//   現在の条件と key が違えば「読み込み中」として扱い、前の条件の数字を出さない。
type BuyerMatchLoad =
  | { status: 'idle' }
  | { status: 'ready'; key: string; summary: BuyerMatchSummary; cells: BuyerMatchCell[] }
  | { status: 'failed'; key: string }
  | { status: 'unavailable' }

// 価格入力の打鍵ごとに集計を叩かないための待ち時間（ms）。
const REFETCH_DELAY_MS = 350

// 凡例5行（tier4→1 ＋ 濃淡データ無し）。地図・PDF と同じ定数から組む
//   （⛔ ラベル・色をここで書き起こさない）。
const LEGEND: LegendRow[] = buildLegendRows(TIER_LABEL, TIER_FILL, NO_DATA_FILL, NO_DATA_LEGEND)

const SELECT_CLASS =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500'
const INPUT_CLASS = SELECT_CLASS
const LABEL_CLASS = 'block mb-1 text-xs font-medium text-slate-500'

// 市区町村の表示名（都道府県があれば前置き）。索引の値をそのまま並べるだけ。
function areaLabel(a: CustomerListArea): string {
  return a.prefecture_name ? `${a.prefecture_name} ${a.muni_name}` : a.muni_name
}

export function BuyerMatchPanel({ listId }: { listId: string }) {
  const [areas, setAreas] = useState<Load<CustomerListArea[]>>({ status: 'loading' })
  const [types, setTypes] = useState<Load<PropertyTypeOption[]>>({ status: 'loading' })

  // 選択値。null は「まだ既定を当てていない」＝下の useMemo で先頭を採る。
  const [muniChoice, setMuniChoice] = useState<string | null>(null)
  const [typeChoice, setTypeChoice] = useState<string | null>(null)
  const [priceMinInput, setPriceMinInput] = useState('')
  const [priceMaxInput, setPriceMaxInput] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const res = await fetchCustomerListAreas(listId)
      if (!alive) return
      setAreas(res.ok ? { status: 'ready', data: res.data } : { status: res.reason === 'unavailable' ? 'unavailable' : 'failed' })
    })()
    return () => {
      alive = false
    }
  }, [listId])

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

  // 参照の安定した配列にしてから派生値の依存に使う（毎レンダーで新配列を作らない）。
  const areaList = useMemo(() => (areas.status === 'ready' ? areas.data : []), [areas])
  const typeList = useMemo(() => (types.status === 'ready' ? types.data : []), [types])

  // 既定値は「選択が無ければ先頭」。選択が一覧から消えた場合も先頭へ戻す。
  //   ⚠ effect 内で同期 setState しない（react-hooks/set-state-in-effect）。派生値で解決する。
  const muniCode5 = useMemo(() => {
    if (muniChoice && areaList.some((a) => a.muni_code_5 === muniChoice)) return muniChoice
    return areaList[0]?.muni_code_5 ?? null
  }, [muniChoice, areaList])

  // 物件種別は必ず1つ選ばれている状態にする（「すべての種別」を作らない）。
  //   見出し文言（裁定34）が「同じ種別」と断定しているため、種別未確定の状態を作らない。
  const propertyType = useMemo(() => {
    if (typeChoice && typeList.some((t) => t.code === typeChoice)) return typeChoice
    return typeList[0]?.code ?? null
  }, [typeChoice, typeList])

  const priceMin = parsePriceInput(priceMinInput)
  const priceMax = parsePriceInput(priceMaxInput)
  // 下限>上限は条件として成り立たない。API へは送らず画面で知らせる（400 を踏まない）。
  const priceInverted = priceMin !== null && priceMax !== null && priceMin > priceMax

  // API へ渡す条件。⛔ school_district_id は含まない（裁定33・案A）。
  //   下限>上限のときは価格条件を落とす（成り立たない条件を送らない）。
  const queryKey = buildBuyerMatchQueryString({
    muniCode5,
    propertyType,
    priceMin: priceInverted ? null : priceMin,
    priceMax: priceInverted ? null : priceMax,
  })

  const [bm, setBm] = useState<BuyerMatchLoad>({ status: 'idle' })

  useEffect(() => {
    if (!muniCode5 || !propertyType) return
    let alive = true
    // 打鍵ごとに叩かないよう待ってから取得する（effect 本体では setState しない）。
    const timer = setTimeout(async () => {
      const [summary, cells] = await Promise.all([
        fetchBuyerMatchSummary(listId, queryKey),
        fetchBuyerMatchCells(listId, queryKey),
      ])
      if (!alive) return
      // どちらかが 404 ＝ FEATURE_BUYER_MATCH off／名簿なし。パネルごと出さない。
      if (
        (!summary.ok && summary.reason === 'unavailable') ||
        (!cells.ok && cells.reason === 'unavailable')
      ) {
        setBm({ status: 'unavailable' })
        return
      }
      if (!summary.ok || !cells.ok) {
        setBm({ status: 'failed', key: queryKey })
        return
      }
      setBm({ status: 'ready', key: queryKey, summary: summary.data, cells: cells.data })
    }, REFETCH_DELAY_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [listId, queryKey, muniCode5, propertyType])

  // 「買い手を見る」ボタンの出し分け（裁定71・①B案）。条件が揃った時点で cards API を
  //   1回呼ぶ。返り値の opt_in でボタンの有無を決め、レスポンス本体は PDF 2枚目のデータ源にも
  //   使う（裁定89・⛔ PDF 生成時に追加 fetch はしない）。⛔ シート内にカードを描かない。
  //   ⛔ opt_in=false ならボタンも案内文も出さない（裁定71）。判定は display.ts の純関数。
  //   条件ごとに key を持たせ、条件変更の途中で前のレスポンスを使ってボタンを出さない。
  const [cardsState, setCardsState] = useState<{ key: string; cards: BuyerMatchCards | null } | null>(null)

  useEffect(() => {
    if (!muniCode5 || !propertyType) return
    let alive = true
    const timer = setTimeout(async () => {
      const res = await fetchBuyerMatchCards(listId, queryKey)
      if (!alive) return
      // 取得失敗（403 含む）は cards=null＝ボタンを出さず PDF も従来のセル集計（fail-closed）。
      setCardsState({ key: queryKey, cards: res.ok ? res.data : null })
    }, REFETCH_DELAY_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [listId, queryKey, muniCode5, propertyType])

  // 現在の条件に対して取得済みの cards（key 不一致＝まだ未確定＝null）。PDF 2枚目の源も兼ねる。
  const currentCards = cardsState?.key === queryKey ? cardsState.cards : null
  // opt_in=true のときだけボタンを描く（判定は display.ts の純関数・fail-closed）。
  const showCardsButton = currentCards !== null && shouldShowBuyerCardsButton(currentCards)
  // 専用画面へのリンク（条件はクエリ文字列で渡す・裁定78。⛔ 別のクエリ組立を作らない・裁定80）。
  const cardsHref = `/customers/buyer-match?list=${encodeURIComponent(listId)}${
    queryKey ? `&${queryKey}` : ''
  }`

  // 条件が変わった直後は前の条件の数字を出さない（key 不一致＝読み込み中）。
  const bmLoading =
    bm.status === 'idle' || (bm.status !== 'unavailable' && bm.key !== queryKey)

  const counts = bm.status === 'ready' ? buildCountDisplays(bm.summary) : null
  const cellsView = bm.status === 'ready' ? buildCellsDisplay(bm.cells) : null

  // 学区図パネル（既存の校区ヒートマップを流用）。同じ PNG を画面と PDF で使う。
  const map = useSchoolDistrictMapPng(listId, muniCode5)
  const mapData = map.status === 'ready' && map.key === (muniCode5 ?? '') ? map.data : null

  // PDF 出力（A4横2枚・裁定31/39）。
  const [pdfStatus, setPdfStatus] = useState<'idle' | 'generating' | 'error'>('idle')
  const canExport = bm.status === 'ready' && bm.key === queryKey

  async function handleExportPdf() {
    if (bm.status !== 'ready') return
    setPdfStatus('generating')
    try {
      // 生成モジュールはクリック時に動的 import する（初期バンドルに乗せない・
      //   @react-pdf/renderer は重く SSR 不可。pdf.tsx のヘッダコメントの作法）。
      const { exportSellerSheetPdf } = await import('@/lib/buyer-match/seller-sheet')
      await exportSellerSheetPdf({
        condition: {
          muniCode5,
          muniName: areaList.find((a) => a.muni_code_5 === muniCode5)?.muni_name ?? null,
          propertyType,
          propertyTypeLabel: typeList.find((t) => t.code === propertyType)?.label_ja ?? null,
          priceMin: priceInverted ? null : priceMin,
          priceMax: priceInverted ? null : priceMax,
        },
        summary: bm.summary,
        cells: bm.cells,
        map: mapData,
        legend: LEGEND,
        mapDisclaimer: SCHOOL_DISTRICT_DISCLAIMER,
        // ⛔ 顧客ロゴの取得経路（P1-5）は本 PR で作らない。undefined＝自社マーク。
        logoSrc: undefined,
        // 2枚目の匿名カード面（裁定88/89）。ボタン判定と同じ取得済みレスポンスを渡す
        //   （⛔ 追加 fetch なし）。null（未取得/失敗）なら従来のセル集計2枚目のまま。
        cards: currentCards,
        labelByCode: Object.fromEntries(typeList.map((t) => [t.code, t.label_ja])),
        muniNameByCode: Object.fromEntries(areaList.map((a) => [a.muni_code_5, a.muni_name])),
      })
      setPdfStatus('idle')
    } catch {
      setPdfStatus('error')
    }
  }

  // 404（FEATURE_CUSTOMER_LIST off／名簿が無い）はセクションごと出さない。
  if (areas.status === 'unavailable') return null
  // 404（FEATURE_BUYER_MATCH off）も同様にセクションごと出さない（二層封鎖の下層に追従）。
  if (bm.status === 'unavailable') return null

  return (
    <section className="mb-8">
      <h2 className="text-sm font-bold mb-1">購入希望マッチ（売主向け）</h2>
      <p className="mb-3 text-xs text-slate-400">
        ご売却をご検討中の物件条件を入れると、直近12ヶ月のお問い合わせから参考人数を集計します。
      </p>

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        {areas.status === 'loading' || types.status === 'loading' ? (
          <div className="flex items-center gap-2 px-1 py-6 text-sm text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            読み込み中…
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* 市区町村（名簿が当たった索引から選ぶ） */}
            <div>
              <label className={LABEL_CLASS} htmlFor="bm-muni">
                市区町村
              </label>
              {areas.status === 'failed' ? (
                <p className="text-sm text-slate-400">市区町村を取得できませんでした</p>
              ) : areaList.length === 0 ? (
                <p className="text-sm text-slate-400">対象の市区町村がありません</p>
              ) : (
                <select
                  id="bm-muni"
                  className={SELECT_CLASS}
                  value={muniCode5 ?? ''}
                  onChange={(e) => setMuniChoice(e.target.value)}
                >
                  {areaList.map((a) => (
                    <option key={a.muni_code_5} value={a.muni_code_5}>
                      {areaLabel(a)}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* 物件種別（property_types・⛔ ラベルを直書きしない） */}
            <div>
              <label className={LABEL_CLASS} htmlFor="bm-type">
                物件種別
              </label>
              {types.status === 'failed' || typeList.length === 0 ? (
                <p className="text-sm text-slate-400">{BUYER_MATCH_MESSAGES.propertyTypesFailed}</p>
              ) : (
                <select
                  id="bm-type"
                  className={SELECT_CLASS}
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

            {/* 査定価格（万円・任意） */}
            <div>
              <label className={LABEL_CLASS} htmlFor="bm-price-min">
                査定価格の下限（万円）
              </label>
              <input
                id="bm-price-min"
                className={INPUT_CLASS}
                inputMode="numeric"
                placeholder="例: 2000"
                value={priceMinInput}
                onChange={(e) => setPriceMinInput(e.target.value)}
              />
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="bm-price-max">
                査定価格の上限（万円）
              </label>
              <input
                id="bm-price-max"
                className={INPUT_CLASS}
                inputMode="numeric"
                placeholder="例: 3000"
                value={priceMaxInput}
                onChange={(e) => setPriceMaxInput(e.target.value)}
              />
            </div>
          </div>
        )}

        {priceInverted && (
          <p className="mt-2 text-xs text-amber-700">
            査定価格の下限が上限を上回っています。価格の条件は反映していません。
          </p>
        )}
      </div>

      {/* ── 集計（大きな数字2つ ＋ 内訳カード）── */}
      <div className="mt-4">
        {bmLoading ? (
          <div className="flex items-center gap-2 px-1 py-6 text-sm text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            読み込み中…
          </div>
        ) : bm.status === 'failed' ? (
          <div className="bg-white border border-slate-200 rounded-xl py-8 px-6 text-center text-sm text-slate-400">
            購入希望の集計を取得できませんでした。
          </div>
        ) : counts && cellsView ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <CountCard display={counts.wide} />
              <CountCard display={counts.near} />
            </div>

            {/* 「買い手を見る」（裁定70/71・①B案）。opt_in=true のときだけ描く。
                ⛔ opt_in=false なら案内文も出さない。⛔ シート内にカードは描かない
                （専用画面 /customers/buyer-match で見せる）。*/}
            {showCardsButton && (
              <div className="mt-4">
                <Link
                  href={cardsHref}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-700 hover:bg-brand-500 text-white text-sm font-medium transition-colors"
                >
                  <Users className="w-4 h-4" />
                  {BUYER_MATCH_CARDS_MESSAGES.button}
                </Link>
              </div>
            )}

            {/* 内訳カード。⛔ n を合算して総数として出さない（1行が複数の価格
                バケットに現れる）。総数は上の大きな数字だけが担う。*/}
            <div className="mt-4">
              <h3 className="mb-2 text-xs font-semibold text-slate-500">内訳</h3>
              {cellsView.emptyMessage ? (
                <div className="bg-white border border-slate-200 rounded-xl py-8 px-6 text-center text-sm text-slate-400">
                  {cellsView.emptyMessage}
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {cellsView.cells.map((c) => (
                    <div
                      key={`${c.property_type}:${c.price_bucket_min ?? 'x'}:${c.floor_area_bucket_min ?? 'x'}`}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                    >
                      <p className="text-xs leading-relaxed text-slate-500">
                        {formatCellTitle(c)}
                      </p>
                      <p className="mt-1 text-lg font-bold text-slate-900">
                        {formatCellCount(c)}
                      </p>
                    </div>
                  ))}
                  {/* 7件目以降。⛔ 残り件数を出さない（裁定34）。*/}
                  {cellsView.overflowLabel && (
                    <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-400">
                      {cellsView.overflowLabel}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 学区図パネル（校区ヒートマップの流用）。⛔ tier 以外は描かない。*/}
            <SchoolDistrictMapCard state={map} muniKey={muniCode5 ?? ''} />

            {/* PDF 出力（A4横2枚）。⛔ 個票・unknown_area_count は出さない。*/}
            <div className="mt-4">
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={!canExport || pdfStatus === 'generating'}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-700 hover:bg-brand-500 disabled:bg-slate-300 text-white text-sm font-medium transition-colors"
              >
                {pdfStatus === 'generating' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                売主向けシートをPDFで出力
              </button>
              {pdfStatus === 'error' && (
                <p className="mt-2 text-xs text-amber-700">
                  PDFの生成に失敗しました。時間をおいて再試行してください。
                </p>
              )}
            </div>

            {/* 免責（裁定30・逐語）。*/}
            <p className="mt-3 text-xs text-slate-400 leading-relaxed">
              {BUYER_MATCH_MESSAGES.disclaimer}
            </p>
          </>
        ) : null}
      </div>
    </section>
  )
}

// 大きな数字1つ分。⛔ suppressed のときは数値を1つも描画しない（display.ts が
//   value を null にしているため、ここで count を組み立て直さない）。
function CountCard({ display }: { display: CountDisplay }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs text-slate-500">{display.heading}</p>
      {display.value === null ? (
        <p className="mt-1 text-sm leading-relaxed text-slate-400">{display.message}</p>
      ) : (
        <p className="mt-1 text-3xl font-bold text-slate-900">
          {formatCountValue(display.value)}
        </p>
      )}
    </div>
  )
}

// 学区図パネル。地図画像＋凡例＋出典＋学区図の免責。
//   ⛔ 出典（attribution_text）は DB の文字列をそのまま出す（前置きしない・組み立て直さない）。
//   学区図が未公開（empty）・取得失敗（failed）のときはパネルごと出さない
//   （売主向けの資料に「取得できません」という内部事情を出さないため）。
function SchoolDistrictMapCard({
  state,
  muniKey,
}: {
  state: ReturnType<typeof useSchoolDistrictMapPng>
  muniKey: string
}) {
  if (state.status !== 'ready' || state.key !== muniKey) return null
  const { pngDataUrl, attributions, tilesFailed } = state.data
  return (
    <div className="mt-4">
      <h3 className="mb-2 text-xs font-semibold text-slate-500">学区図</h3>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element -- Canvas 合成の data URL のため next/image は使えない */}
        <img src={pngDataUrl} alt="校区の学区図" className="block w-full" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {LEGEND.map((row) => (
          <span key={row.label} className="inline-flex items-center gap-1 text-xs text-slate-500">
            <span
              className="inline-block h-2.5 w-3.5 rounded-[2px] border border-slate-400"
              style={{
                backgroundColor: row.color,
                opacity: row.opacity,
                borderStyle: row.dashed ? 'dashed' : 'solid',
              }}
            />
            {row.label}
          </span>
        ))}
      </div>
      {tilesFailed && (
        <p className="mt-1 text-xs text-amber-700">一部の地図タイルを取得できませんでした</p>
      )}
      {attributions.length > 0 && (
        <p className="mt-1 text-xs text-slate-400 leading-relaxed">{attributions.join(' / ')}</p>
      )}
      <p className="mt-1 text-xs text-slate-400 leading-relaxed">{SCHOOL_DISTRICT_DISCLAIMER}</p>
    </div>
  )
}

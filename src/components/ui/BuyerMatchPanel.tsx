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
import { Loader2 } from 'lucide-react'
import { BUYER_MATCH_MESSAGES } from '@/lib/buyer-match/messages'
import { parsePriceInput } from '@/lib/buyer-match/request'
import {
  fetchCustomerListAreas,
  fetchPropertyTypes,
  type CustomerListArea,
} from '@/lib/buyer-match/client'
import type { PropertyTypeOption } from '@/lib/buyer-match/types'

// 非同期取得の状態。'unavailable' は 404（機能なし／名簿なし）で、パネルごと出さない。
type Load<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'failed' }
  | { status: 'unavailable' }

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

  // 404（FEATURE_CUSTOMER_LIST off／名簿が無い）はセクションごと出さない。
  if (areas.status === 'unavailable') return null

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
    </section>
  )
}

'use client'

// =====================================================================
// PR-BM-9b-2: 購入希望マッチ 匿名カードの表示（プレゼンテーションのみ）。
//   ⛔ データ取得を持たない。抑止判定・ラベル解決・見出し組立は呼び出し側
//     （buyer-match/page.tsx）が display.ts の純関数で済ませ、表示可能な props を渡す。
//   レイアウトは裁定76:「条件ボックス（見出し）→ 大きな人数 → 3列のカード」。
//   カードのバッジは物件種別（property_types の先頭・label_ja）。
//   ⛔ 間取りチップ・反響種別バッジを作らない（データが存在しない・裁定76）。
//   #01〜 の番号は配列 index+1 でクライアントが振る（裁定74）。
//     ⛔ カードのデータに番号を持たせない・⛔ 並べ替えない（RPC がランダム順で返す）。
//   ⛔ 氏名・担当・顧客番号・住所・反響日・媒体・間取りは扱わない（型に存在しない）。
// =====================================================================

import { BUYER_MATCH_CARDS_MESSAGES } from '@/lib/buyer-match/messages'
import {
  formatCardArea,
  hasAreaRow,
  hasDistrictsRow,
  resolveCardBadgeLabel,
} from '@/lib/buyer-match/display'
import type { BuyerMatchCard } from '@/lib/buyer-match/types'

interface BuyerMatchCardsViewProps {
  // used_conditions から組んだ見出し（裁定73）。
  heading: string
  // matched_count を「○名」に整形した文字列（裁定75）。⛔ stage/k/max_cards は含めない。
  countLabel: string
  // RPC が返した順のまま（⛔ 並べ替えない・裁定74）。
  cards: BuyerMatchCard[]
  // property_type code → label_ja（バッジ解決用・裁定76）。
  labelByCode: Record<string, string>
}

// #01 形式の連番（配列 index+1・裁定74）。2桁ゼロ詰め。
function cardNumber(index: number): string {
  return `#${String(index + 1).padStart(2, '0')}`
}

export function BuyerMatchCardsView({
  heading,
  countLabel,
  cards,
  labelByCode,
}: BuyerMatchCardsViewProps) {
  return (
    <div>
      {/* 条件ボックス（見出し＝used_conditions 由来）。*/}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
        <p className="text-sm font-semibold text-slate-700">{heading}</p>
      </div>

      {/* 大きな人数（matched_count・裁定75「○名」）。⛔ stage/k/max_cards は出さない。*/}
      <p className="mt-4 text-4xl font-bold text-slate-900">{countLabel}</p>

      {/* 3列のカード（裁定76）。番号は index+1・並べ替えない。*/}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card, i) => (
          <BuyerMatchCardItem
            key={i}
            number={cardNumber(i)}
            card={card}
            labelByCode={labelByCode}
          />
        ))}
      </div>
    </div>
  )
}

function BuyerMatchCardItem({
  number,
  card,
  labelByCode,
}: {
  number: string
  card: BuyerMatchCard
  labelByCode: Record<string, string>
}) {
  const badge = resolveCardBadgeLabel(card.property_types, labelByCode)
  const showFloor = hasAreaRow(card.desired_floor_area_min, card.desired_floor_area_max)
  const showLand = hasAreaRow(card.desired_land_area_min, card.desired_land_area_max)
  const showDistricts = hasDistrictsRow(card)
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center rounded-md bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700">
          {badge}
        </span>
        <span className="text-xs font-medium text-slate-400">{number}</span>
      </div>
      <dl className="mt-2 space-y-1.5 text-xs">
        {showFloor && (
          <div className="flex gap-2">
            <dt className="shrink-0 text-slate-400">{BUYER_MATCH_CARDS_MESSAGES.rowFloorArea}</dt>
            <dd className="text-slate-700">
              {formatCardArea(card.desired_floor_area_min, card.desired_floor_area_max)}
            </dd>
          </div>
        )}
        {showLand && (
          <div className="flex gap-2">
            <dt className="shrink-0 text-slate-400">{BUYER_MATCH_CARDS_MESSAGES.rowLandArea}</dt>
            <dd className="text-slate-700">
              {formatCardArea(card.desired_land_area_min, card.desired_land_area_max)}
            </dd>
          </div>
        )}
        {showDistricts && (
          <div className="flex gap-2">
            <dt className="shrink-0 text-slate-400">{BUYER_MATCH_CARDS_MESSAGES.rowDistricts}</dt>
            <dd className="text-slate-700">{card.desired_districts.join('、')}</dd>
          </div>
        )}
      </dl>
    </div>
  )
}

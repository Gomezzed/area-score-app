// ============================================================
// PR-BM-7: 売主向けシート PDF の表示モデル（純ロジック・依存は純モジュールのみ）。
//   ファイル名／タイトル／物件条件の見出し行を組む。
//   ⛔ 個票の値（氏名・担当者・外部ID・住所・反響日）を持たない。
//   ⛔ unknown_area_count を持たない（型にも入れない・types.ts と同方針）。
//   ⚠ node --test は '@/' を解決できないため相対 import・拡張子付きで書く。
// ============================================================

import {
  buildBuyerCardsHeading,
  formatCardArea,
  formatCardPrice,
  formatCountValue,
  hasAreaRow,
  hasDistrictsRow,
  hasPriceRow,
  resolveCardBadgeLabel,
  shouldShowBuyerCards,
  shouldShowBuyerCardsButton,
} from '../display.ts'
import { BUYER_MATCH_CARDS_MESSAGES } from '../messages.ts'
import type { BuyerMatchCard, BuyerMatchCards, SellerCondition } from '../types.ts'

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

// JST(UTC+9・DST なし)へ変換（heatmap-pdf/model.ts の toJstParts と同じ規約）。
function toJstParts(d: Date) {
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return {
    y: j.getUTCFullYear(),
    mo: j.getUTCMonth() + 1,
    day: j.getUTCDate(),
    h: j.getUTCHours(),
    mi: j.getUTCMinutes(),
  }
}

// ファイル名（ASCII のみ・UUID を含めない・日時は JST）。
//   areascore_buyer-match_{muni_code_5}_{property_type}_{YYYYMMDD-HHmm}.pdf
//   ⛔ 名簿 UUID・顧客名を含めない。muni/種別が未確定なら 'all' で埋める。
export function buildSellerSheetFileName(
  muniCode5: string | null,
  propertyType: string | null,
  d: Date,
): string {
  const p = toJstParts(d)
  const stamp = `${p.y}${pad2(p.mo)}${pad2(p.day)}-${pad2(p.h)}${pad2(p.mi)}`
  return `areascore_buyer-match_${muniCode5 ?? 'all'}_${propertyType ?? 'all'}_${stamp}.pdf`
}

// 画面上のタイトル・PDF メタデータ title。
export function buildSellerSheetTitle(condition: SellerCondition): string {
  const area = condition.muniName ?? ''
  const type = condition.propertyTypeLabel ?? ''
  const suffix = [area, type].filter((v) => v !== '').join('／')
  return suffix ? `購入希望マッチ ― ${suffix}` : '購入希望マッチ'
}

// 査定価格の表記。両端 null は空文字（条件行に出さない）。
export function formatConditionPrice(min: number | null, max: number | null): string {
  const fmt = (n: number) => n.toLocaleString('ja-JP')
  if (min !== null && max !== null) return `${fmt(min)}〜${fmt(max)}万円`
  if (min !== null) return `${fmt(min)}万円以上`
  if (max !== null) return `${fmt(max)}万円以下`
  return ''
}

// ヘッダに出す物件条件の行（値の無い項目は行ごと出さない）。
//   ⛔ 顧客側の情報は一切入らない。売主が入力した条件だけ。
export function buildConditionLines(condition: SellerCondition): string[] {
  const lines: string[] = []
  if (condition.muniName) lines.push(`エリア: ${condition.muniName}`)
  if (condition.propertyTypeLabel) lines.push(`物件種別: ${condition.propertyTypeLabel}`)
  const price = formatConditionPrice(condition.priceMin, condition.priceMax)
  if (price) lines.push(`査定価格: ${price}`)
  return lines
}

// ============================================================
// PR-BM-9b-3: PDF 2枚目「匿名カード」の表示モデル（裁定88〜93）。
//   BuyerMatchPanel が既に持つ cards レスポンス（BuyerMatchCards）から、PDF が描く
//   だけの表示用データを組む。⛔ 追加 fetch はしない（配線は index.ts / Panel 側）。
//   ⚠ 画面（app/customers/buyer-match/page.tsx の CardsBody ＋ ui/BuyerMatchCardsView）と
//     同一の判定・整形を通すため、整形・見出し・文言は display.ts / messages.ts の関数と
//     定数だけを呼ぶ（⛔ 独自整形を書かない・裁定90）。例外は裁定96 が複製を許可した2点
//     （#01 連番・desired_districts の「、」結合）のみ。
//
//   ⚠ 画面と PDF は cards レスポンスを別々に取得するため、同条件でも 6人が異なり得る
//     （RPC はランダム順で最大 max_cards 件を返す・裁定89）。これは仕様。
// ============================================================

// カード1行の表示ラベル＋値（値の無い行は null＝行ごと出さない）。
export interface BuyerCardRow {
  label: string
  value: string
}

// カード1枚の表示データ（裁定90: バッジ＋#NN＋希望予算＋専有面積＋土地面積＋校区）。
export interface BuyerCardView {
  // #01〜（裁定74・裁定96 で PDF 複製可）。
  number: string
  // 物件種別 label_ja（resolveCardBadgeLabel・裁定76）。
  badge: string
  // 希望予算（先頭・太字・裁定81）。両方 null なら null。
  priceRow: BuyerCardRow | null
  floorRow: BuyerCardRow | null
  landRow: BuyerCardRow | null
  districtsRow: BuyerCardRow | null
}

// PDF 2枚目の3分岐（裁定88）。判定は display.ts の純関数のみ（⛔ cards.length で判定しない）。
//   'cards'      … opt_in=true かつ表示可（見出し・人数・カード・免責）
//   'suppressed' … opt_in=true かつ suppressed / stage=null（抑止文言＋免責）
//   'legacy'     … opt_in=false（従来のセル集計2枚目・⛔ 1文字も変えない）
export type BuyerCardsPageModel =
  | { kind: 'legacy' }
  | { kind: 'suppressed' }
  | { kind: 'cards'; heading: string; countLabel: string; cards: BuyerCardView[] }

// #01 の連番＝配列 index+1・2桁ゼロ詰め。
//   ⚠ 裁定96 で複製を許可された2点のうちの1つ（画面 ui/BuyerMatchCardsView.tsx:37-40
//     の cardNumber と同一ロジック。display.ts へは後日別 PR で移す候補）。
function cardNumber(index: number): string {
  return `#${String(index + 1).padStart(2, '0')}`
}

function buildCardView(
  card: BuyerMatchCard,
  index: number,
  labelByCode: Record<string, string>,
): BuyerCardView {
  const M = BUYER_MATCH_CARDS_MESSAGES
  return {
    number: cardNumber(index),
    badge: resolveCardBadgeLabel(card.property_types, labelByCode),
    // 行の有無は has*Row（display.ts）で決め、値は format*（display.ts）で整形する。
    priceRow: hasPriceRow(card.price_min, card.price_max)
      ? { label: M.rowPrice, value: formatCardPrice(card.price_min, card.price_max) }
      : null,
    floorRow: hasAreaRow(card.desired_floor_area_min, card.desired_floor_area_max)
      ? { label: M.rowFloorArea, value: formatCardArea(card.desired_floor_area_min, card.desired_floor_area_max) }
      : null,
    landRow: hasAreaRow(card.desired_land_area_min, card.desired_land_area_max)
      ? { label: M.rowLandArea, value: formatCardArea(card.desired_land_area_min, card.desired_land_area_max) }
      : null,
    // desired_districts の「、」結合。
    //   ⚠ 裁定96 で複製を許可された2点のもう1つ（画面 ui/BuyerMatchCardsView.tsx:124 と同一）。
    districtsRow: hasDistrictsRow(card)
      ? { label: M.rowDistricts, value: card.desired_districts.join('、') }
      : null,
  }
}

// cards レスポンス → PDF 2枚目の表示モデル。
//   labelByCode: property_type code → label_ja（バッジ・見出しの種別解決／Panel の typeList 由来）。
//   muniNameByCode: muni_code_5 → muni_name（段4 見出しの市区町村名解決／Panel の areaList 由来）。
export function buildBuyerCardsPageModel(
  cards: BuyerMatchCards,
  labelByCode: Record<string, string>,
  muniNameByCode: Record<string, string>,
): BuyerCardsPageModel {
  // 裁定88: opt_in=false は従来のセル集計2枚目のまま（判定は display.ts）。
  if (!shouldShowBuyerCardsButton(cards)) return { kind: 'legacy' }
  // 裁定88/72: opt_in=true でも suppressed / stage=null は抑止文言（⛔ cards.length で判定しない）。
  if (!shouldShowBuyerCards(cards)) return { kind: 'suppressed' }

  const used = cards.used_conditions
  // 見出しは used_conditions 由来（裁定73）。種別/市区町村名を解決して純関数へ渡す。
  const heading = used
    ? buildBuyerCardsHeading(
        used,
        used.property_type ? labelByCode[used.property_type] ?? null : null,
        used.muni_code_5 ? muniNameByCode[used.muni_code_5] ?? null : null,
      )
    : ''
  return {
    kind: 'cards',
    heading,
    // 大きな人数＝matched_count を「○名」に整形（裁定75）。⛔ stage/k/max_cards は出さない。
    countLabel: formatCountValue(cards.matched_count),
    cards: cards.cards.map((card, i) => buildCardView(card, i, labelByCode)),
  }
}

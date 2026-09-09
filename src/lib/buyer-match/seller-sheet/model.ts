// ============================================================
// PR-BM-7: 売主向けシート PDF の表示モデル（純ロジック・依存は純モジュールのみ）。
//   ファイル名／タイトル／物件条件の見出し行を組む。
//   ⛔ 個票の値（氏名・担当者・外部ID・住所・反響日）を持たない。
//   ⛔ unknown_area_count を持たない（型にも入れない・types.ts と同方針）。
//   ⚠ node --test は '@/' を解決できないため相対 import・拡張子付きで書く。
// ============================================================

import type { SellerCondition } from '../types.ts'

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

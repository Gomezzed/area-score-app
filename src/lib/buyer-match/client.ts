'use client'

// ============================================================
// PR-BM-7: 売主向けシートのデータ取得（ブラウザ専用）。
//   - summary / cells は BM-5 の GET ルート経由（認可は API 側の
//     isCustomerListEnabled → isBuyerMatchEnabled → guardFeature が担う）。
//     ⛔ 本モジュールは認可判定を一切しない。表示の可否は「取れたか」だけで決める。
//   - ⛔ /buyer-match/rows（個票・氏名/担当者を含む・k 抑止なし）は呼ばない。
//     売主に見せる経路から到達させないため、ここに関数自体を置かない。
//   - property_types は既存のブラウザ Supabase クライアントで直読みする（裁定35）。
//     RLS: property_types_select（authenticated は SELECT 可）／anon は REVOKE 済み。
//   ⚠ FEATURE_BUYER_MATCH はサーバー専用フラグで NEXT_PUBLIC 対応物が無い。
//     クライアントは事前に有効/無効を知り得ないため、404 を 'unavailable' として
//     受け、パネルごと描画しないことで二層封鎖の下層に追従する。
// ============================================================

import { supabase } from '@/lib/supabase'
import type { BuyerMatchCell, BuyerMatchSummary, PropertyTypeOption } from './types'

// 取得結果。'unavailable'＝機能が無い/名簿が無い（404）。'failed'＝それ以外の失敗。
export type FetchOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unavailable' | 'failed' }

// 取込エリア一覧の1行（GET /api/customer-lists/[id]/areas の areas[]）。
export interface CustomerListArea {
  muni_code_5: string
  muni_name: string
  prefecture_name: string | null
  has_school_districts: boolean
}

async function getJson<T>(url: string): Promise<FetchOutcome<T>> {
  try {
    const res = await fetch(url)
    if (res.status === 404) return { ok: false, reason: 'unavailable' }
    if (!res.ok) return { ok: false, reason: 'failed' }
    return { ok: true, data: (await res.json()) as T }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}

// 売主条件に対する2つの数（k 抑止済み）。query は buildBuyerMatchQueryString の出力。
export async function fetchBuyerMatchSummary(
  listId: string,
  query: string,
): Promise<FetchOutcome<BuyerMatchSummary>> {
  const suffix = query ? `?${query}` : ''
  return getJson<BuyerMatchSummary>(
    `/api/customer-lists/${encodeURIComponent(listId)}/buyer-match/summary${suffix}`,
  )
}

// 内訳カードのセル集計。⚠ レスポンスは { id, rows } でラップされている（裁定36）。
export async function fetchBuyerMatchCells(
  listId: string,
  query: string,
): Promise<FetchOutcome<BuyerMatchCell[]>> {
  const suffix = query ? `?${query}` : ''
  const res = await getJson<{ rows?: BuyerMatchCell[] }>(
    `/api/customer-lists/${encodeURIComponent(listId)}/buyer-match/cells${suffix}`,
  )
  if (!res.ok) return res
  return { ok: true, data: res.data.rows ?? [] }
}

// 名簿が当たった市区町村の索引（市区町村セレクトの選択肢）。
//   ★索引であって集計ではない（生件数は返らない設計）。
export async function fetchCustomerListAreas(
  listId: string,
): Promise<FetchOutcome<CustomerListArea[]>> {
  const res = await getJson<{ areas?: CustomerListArea[] }>(
    `/api/customer-lists/${encodeURIComponent(listId)}/areas`,
  )
  if (!res.ok) return res
  return { ok: true, data: res.data.areas ?? [] }
}

// 物件種別マスタ（裁定35）。is_active = true のみ・sort_order 昇順。
//   ⛔ 6値のラベルをクライアントに直書きしない。DB が唯一の定義（原則19）。
export async function fetchPropertyTypes(): Promise<FetchOutcome<PropertyTypeOption[]>> {
  const { data, error } = await supabase
    .from('property_types')
    .select('code, label_ja')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
  if (error) return { ok: false, reason: 'failed' }
  return { ok: true, data: (data ?? []) as PropertyTypeOption[] }
}

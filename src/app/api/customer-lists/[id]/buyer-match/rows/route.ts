// ⛔ 社内画面専用。売主向けの画面・PDF・共有リンクからは呼ばない。
//   get_buyer_match_rows は k=5 の匿名化をかけず、氏名(customer_name)・担当者(assignee)
//   を含む実在行を返す（BM-4 RPC コメント参照）。将来 BM-7 等が誤って売主導線から
//   呼ばないよう、レスポンスに internal_only: true を含め、キャッシュもさせない。

import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { guardFeature } from '@/lib/subscription'
import { isCustomerListEnabled } from '@/lib/customer-list/server'
import { isBuyerMatchEnabled } from '@/lib/server/feature-flags'
import { parseBuyerMatchQueryParams } from '@/lib/buyer-match/query-params'

export const runtime = 'nodejs'

// レスポンスにキャッシュさせないための共通ヘッダ（裁定28）。全レスポンス（エラー含む）に付ける。
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const

function jsonNoStore(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS })
}

// 個票1行（RPC get_buyer_match_rows の返り列そのまま）。
interface BuyerMatchRow {
  row_id: string
  external_id: string | null
  customer_name: string | null
  assignee: string | null
  property_types: string[]
  price_min: number | null
  price_max: number | null
  desired_floor_area_min: number | null
  desired_floor_area_max: number | null
  inquiry_at: string | null
  match_method: string | null
}

// GET /api/customer-lists/[id]/buyer-match/rows
//   ?muni_code_5=&school_district_id=&property_type=&price_min=&price_max=
//
//   買い希望の個票（社内画面専用・氏名/担当者を含む・k抑止なし）を返す
//   （RPC get_buyer_match_rows・summary の near_count と同じ絞り込み条件）。
//   認可の並びは summary/cells ルートと逐語で揃える（裁定25）:
//     ① isCustomerListEnabled() off → 404 ② isBuyerMatchEnabled() off → 404
//     ③ guardFeature('townAcquisitionPriority')（既存キーを流用）
//     ④ customer_lists の存在確認（RLS 経由・null なら 404）
//     ⑤ RPC 呼び出し（失敗は 500・RPC のエラーメッセージは返さない）
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isCustomerListEnabled()) {
    return jsonNoStore({ error: 'not_found' }, 404)
  }
  if (!isBuyerMatchEnabled()) {
    return jsonNoStore({ error: 'not_found' }, 404)
  }
  const denied = await guardFeature('townAcquisitionPriority')
  if (denied) {
    const body = await denied.json()
    return jsonNoStore(body, denied.status)
  }

  const parsed = parseBuyerMatchQueryParams(request.nextUrl.searchParams)
  if (!parsed.ok) {
    return jsonNoStore({ error: 'invalid_parameter', parameter: parsed.parameter }, 400)
  }

  const { id: listId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: list } = await supabase
    .from('customer_lists')
    .select('id')
    .eq('id', listId)
    .maybeSingle()
  if (!list) {
    return jsonNoStore({ error: 'not_found' }, 404)
  }

  const { data, error } = await supabase.rpc('get_buyer_match_rows', {
    p_list_id: listId,
    p_muni_code_5: parsed.params.muniCode5,
    p_school_district_id: parsed.params.schoolDistrictId,
    p_property_type: parsed.params.propertyType,
    p_price_min: parsed.params.priceMin,
    p_price_max: parsed.params.priceMax,
  })
  if (error) {
    return jsonNoStore({ error: 'fetch_failed' }, 500)
  }

  const rows = (data ?? []) as BuyerMatchRow[]
  // internal_only: true — 社内画面専用であることをレスポンス自体にも明示する（裁定28）。
  return jsonNoStore({ id: listId, internal_only: true, rows }, 200)
}

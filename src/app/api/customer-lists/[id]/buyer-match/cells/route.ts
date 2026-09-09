import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { guardFeature } from '@/lib/subscription'
import { isCustomerListEnabled } from '@/lib/customer-list/server'
import { isBuyerMatchEnabled } from '@/lib/server/feature-flags'
import { parseBuyerMatchQueryParams } from '@/lib/buyer-match/query-params'

export const runtime = 'nodejs'

// 内訳カード1セル（RPC get_buyer_match_cells の返り列そのまま）。
interface BuyerMatchCell {
  property_type: string
  label_ja: string
  price_bucket_min: number | null
  price_bucket_max: number | null
  floor_area_bucket_min: number | null
  floor_area_bucket_max: number | null
  n: number
}

// GET /api/customer-lists/[id]/buyer-match/cells
//   ?muni_code_5=&school_district_id=&property_type=&price_min=&price_max=
//
//   買い希望の内訳カード（物件種別×価格帯×専有面積帯のセル集計）を返す
//   （RPC get_buyer_match_cells・k=5 未満のセルは行ごと存在しない・BM-4 裁定15/19）。
//   認可の並びは summary ルートと逐語で揃える（裁定25）:
//     ① isCustomerListEnabled() off → 404 ② isBuyerMatchEnabled() off → 404
//     ③ guardFeature('townAcquisitionPriority')（既存キーを流用）
//     ④ customer_lists の存在確認（RLS 経由・null なら 404）
//     ⑤ RPC 呼び出し（失敗は 500・RPC のエラーメッセージは返さない）
//
//   ⛔ セルの n を合算して総数として表示しないこと（1行が複数の価格バケットに現れ得る・
//     RPC コメント参照）。総数が要る場合は summary ルートの wide_count/near_count を使う。
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isCustomerListEnabled()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (!isBuyerMatchEnabled()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const denied = await guardFeature('townAcquisitionPriority')
  if (denied) return denied

  const parsed = parseBuyerMatchQueryParams(request.nextUrl.searchParams)
  if (!parsed.ok) {
    return NextResponse.json(
      { error: 'invalid_parameter', parameter: parsed.parameter },
      { status: 400 },
    )
  }

  const { id: listId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: list } = await supabase
    .from('customer_lists')
    .select('id')
    .eq('id', listId)
    .maybeSingle()
  if (!list) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const { data, error } = await supabase.rpc('get_buyer_match_cells', {
    p_list_id: listId,
    p_muni_code_5: parsed.params.muniCode5,
    p_school_district_id: parsed.params.schoolDistrictId,
    p_property_type: parsed.params.propertyType,
    p_price_min: parsed.params.priceMin,
    p_price_max: parsed.params.priceMax,
  })
  if (error) {
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 })
  }

  const rows = (data ?? []) as BuyerMatchCell[]
  return NextResponse.json({ id: listId, rows })
}

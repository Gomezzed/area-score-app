import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { guardFeature } from '@/lib/subscription'
import { isCustomerListEnabled } from '@/lib/customer-list/server'
import { isBuyerMatchEnabled } from '@/lib/server/feature-flags'
import { parseBuyerMatchQueryParams } from '@/lib/buyer-match/query-params'

export const runtime = 'nodejs'

// GET /api/customer-lists/[id]/buyer-match/summary
//   ?muni_code_5=&school_district_id=&property_type=&price_min=&price_max=
//
//   売主の物件条件に対し、当該名簿の買い希望(lead_type='buy')を wide_count/near_count の
//   2つの数で返す（RPC get_buyer_match_summary・k=5 匿名化済み・BM-4 裁定15）。
//   認可の並びは既存の customer-lists 系GETルートと逐語で揃える（裁定25）:
//     ① isCustomerListEnabled() off → 404（親：顧客リスト機能そのもの）
//     ② isBuyerMatchEnabled() off   → 404（子：買い希望マッチ・FEATURE_BUYER_MATCH）
//     ③ guardFeature('townAcquisitionPriority')（既存キーを流用・新規キーは作らない）
//     ④ customer_lists の存在確認（RLS 経由・null なら 404）
//     ⑤ RPC 呼び出し（失敗は 500・RPC のエラーメッセージは返さない）
//   RPC は SECURITY INVOKER のため、このユーザーセッションで RLS・current_user_plan()
//   がそのまま効く（＝認可の要）。
//
//   ⛔ unknown_area_count は k 抑止(k=5)の対象外の生値（BM-4 裁定17）。
//     売主向け表示に出さないこと・出す場合の抑止設計は BM-7 の責務（本PRでは判断しない）。
//   裁定24: RPC が返す jsonb はそのまま透過する（キーの追加・改変をしない）。
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

  // 名簿の存在＆所有確認（RLS: 自分の org の行のみ SELECT 可）。attack-list と同型。
  const { data: list } = await supabase
    .from('customer_lists')
    .select('id')
    .eq('id', listId)
    .maybeSingle()
  if (!list) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const { data, error } = await supabase.rpc('get_buyer_match_summary', {
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

  // 裁定24: jsonb をそのまま透過する。
  return NextResponse.json(data ?? {})
}

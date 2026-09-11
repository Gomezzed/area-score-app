import type { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { guardFeature } from '@/lib/subscription'
import { isCustomerListEnabled } from '@/lib/customer-list/server'
import { isBuyerMatchEnabled } from '@/lib/server/feature-flags'
import { parseBuyerMatchCardsQueryParams } from '@/lib/buyer-match/query-params'
import { jsonNoStore } from '@/lib/buyer-match/http'

export const runtime = 'nodejs'

// GET /api/buyer-match/cards
//   ?muni_code_5=&property_type=&price_min=&price_max=
//
//   踏襲元: src/app/api/customer-lists/[id]/buyer-match/cards/route.ts
//   list_id を持たない org スコープ版（BM-10b）。認可の並びは踏襲元と逐語で揃える。
//   異なるのは ⑤（名簿存在確認）を省略する点のみ。
//     ① isCustomerListEnabled() off → 404
//     ② isBuyerMatchEnabled() off   → 404
//     ③ guardFeature('townAcquisitionPriority') → 403（denied.json() を no-store で再ラップ）
//     ④ パラメータ検証 → 400（property_type 必須・school_district_id は受け取らない・裁定57/67）
//     -- ⑤ 名簿存在確認は対象なしのため省略（裁定-bm-G）
//     ⑥ RPC 呼び出し（get_buyer_match_cards）→ 500（RPC のメッセージは返さない）
//   ⚠ 親フラグ①を省略しない（子だけ生きてはならない）。
export async function GET(request: NextRequest) {
  // ① 親：顧客リスト機能が off → 404。
  if (!isCustomerListEnabled()) {
    return jsonNoStore({ error: 'not_found' }, 404)
  }
  // ② 子：買い希望マッチが off → 404（FEATURE_BUYER_MATCH）。
  if (!isBuyerMatchEnabled()) {
    return jsonNoStore({ error: 'not_found' }, 404)
  }
  // ③ Platinum ガード（既存キー townAcquisitionPriority を流用）。
  const denied = await guardFeature('townAcquisitionPriority')
  if (denied) {
    const body = await denied.json()
    return jsonNoStore(body, denied.status)
  }

  // ④ パラメータ検証（cards は property_type 必須・school_district_id は受け取らない・裁定57/67）。
  //    ⛔ 受け取った値はレスポンスに含めない（D144）。
  const parsed = parseBuyerMatchCardsQueryParams(request.nextUrl.searchParams)
  if (!parsed.ok) {
    return jsonNoStore({ error: 'invalid_parameter', parameter: parsed.parameter }, 400)
  }

  const supabase = await createSupabaseServerClient()

  // ⑥ RPC 呼び出し。p_list_id は常に null。school_district_id は cards では常に null（裁定67）。
  //   失敗は 500・RPC のメッセージは返さない。
  const { data, error } = await supabase.rpc('get_buyer_match_cards', {
    p_list_id: null,
    p_muni_code_5: parsed.params.muniCode5,
    p_school_district_id: null,
    p_property_type: parsed.params.propertyType,
    p_price_min: parsed.params.priceMin,
    p_price_max: parsed.params.priceMax,
  })
  if (error) {
    return jsonNoStore({ error: 'fetch_failed' }, 500)
  }

  // 裁定60/66: RPC が返す jsonb を無改変で透過する（summary と同型で data ?? {} を返す・
  //   {id,rows} で包まない・stage / matched_count / cards を加工しない）。
  return jsonNoStore(data ?? {}, 200)
}

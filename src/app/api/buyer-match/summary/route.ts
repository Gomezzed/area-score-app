import type { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { guardFeature } from '@/lib/subscription'
import { isCustomerListEnabled } from '@/lib/customer-list/server'
import { isBuyerMatchEnabled } from '@/lib/server/feature-flags'
import { parseBuyerMatchQueryParams } from '@/lib/buyer-match/query-params'
import { jsonNoStore } from '@/lib/buyer-match/http'

export const runtime = 'nodejs'

// GET /api/buyer-match/summary
//   ?muni_code_5=&school_district_id=&property_type=&price_min=&price_max=
//
//   踏襲元: src/app/api/customer-lists/[id]/buyer-match/summary/route.ts
//   list_id を持たない org スコープ版（BM-10b）。認可の並びは踏襲元と逐語で揃える。
//   異なるのは ⑤（名簿存在確認）を省略する点と、全 return を no-store にする点
//   （cards/rows 型を踏襲・裁定-bm-J）のみ。
//     ① isCustomerListEnabled() off → 404
//     ② isBuyerMatchEnabled() off   → 404
//     ③ guardFeature('townAcquisitionPriority') → 403（denied.json() を no-store で再ラップ）
//     ④ パラメータ検証 → 400（値はエコーしない・D144）
//     -- ⑤ 名簿存在確認は対象なしのため省略（裁定-bm-G）
//     ⑥ RPC 呼び出し（get_buyer_match_summary）→ 500（RPC のメッセージは返さない）
//
//   RPC は p_list_id: null（呼び出し者が RLS で見える全名簿を合算・BM-10a）。
//   p_school_district_id は summary でも null 固定（裁定67 を踏襲）。
//
//   ⛔ unknown_area_count は k 抑止(k=5)の対象外の生値（BM-4 裁定17）。
//     売主向け表示に出さないこと（BM-7 の責務。本ルートでは判断しない）。
//   裁定24: RPC が返す jsonb はそのまま透過する（キーの追加・改変をしない）。
export async function GET(request: NextRequest) {
  // ① 親：顧客リスト機能が off → 404（機能の存在自体を晒さない）。
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

  // ④ パラメータ検証（既存の全パラメータ版パーサを無改変で流用。list_id 非依存）。
  const parsed = parseBuyerMatchQueryParams(request.nextUrl.searchParams)
  if (!parsed.ok) {
    return jsonNoStore({ error: 'invalid_parameter', parameter: parsed.parameter }, 400)
  }

  const supabase = await createSupabaseServerClient()

  // ⑥ RPC 呼び出し。p_list_id は常に null（org スコープ・BM-10a）。
  //   p_school_district_id は summary でも null 固定（裁定67）。
  const { data, error } = await supabase.rpc('get_buyer_match_summary', {
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

  // 裁定24: jsonb をそのまま透過する。
  return jsonNoStore(data ?? {}, 200)
}

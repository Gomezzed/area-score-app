import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { guardFeature } from '@/lib/subscription'
import { isCustomerListEnabled } from '@/lib/customer-list/server'
import { isBuyerMatchEnabled } from '@/lib/server/feature-flags'
import { parseBuyerMatchCardsQueryParams } from '@/lib/buyer-match/query-params'

export const runtime = 'nodejs'

// レスポンスにキャッシュさせないための共通ヘッダ（裁定64）。全経路（404/400/403/500/200）
// に付ける。匿名化済みでも 1枚＝1人の粒度のため rows と同じ扱いにする（裁定59）。
//   ⚠ jsonNoStore は rows/route.ts と同一形の流用（裁定64）。既存3ルートは触らない規約
//     （手順の「触らないもの」）のため export 共有はせず、同じヘルパをここに置いて挙動を
//     rows と逐語で揃える。⛔ 別のキャッシュ機構を新設しない。
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const

function jsonNoStore(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS })
}

// GET /api/customer-lists/[id]/buyer-match/cards
//   ?muni_code_5=&property_type=&price_min=&price_max=
//
//   売主の物件条件に対し、当該名簿の買い希望を k=5 匿名化した「カード」を最大6枚返す
//   （RPC get_buyer_match_cards・opt_in / stage / matched_count / suppressed / cards[] を
//   含む単一 jsonb を無改変で透過・裁定60/66）。
//   ⛔ school_district_id は受け取らない。RPC には常に null を渡す（裁定67・33/46）。
//   認可の並びは BM-5 の既存3ルート（summary/cells/rows）と逐語で統一する（裁定63）:
//     ① isCustomerListEnabled() が false → 404 {error:'not_found'}（親：顧客リスト機能）
//     ② isBuyerMatchEnabled() が false  → 404 {error:'not_found'}（子：買い希望マッチ）
//     ③ guardFeature('townAcquisitionPriority') → denied なら 403（既存キー流用・裁定62）
//     ④ パラメータ検証 → 不正なら 400 {error:'invalid_parameter', parameter}（値はエコーしない）
//     ⑤ customer_lists の存在確認（RLS 経由・null なら 404）
//     ⑥ RPC 呼び出し → error なら 500 {error:'fetch_failed'}（RPC メッセージは返さない）
//   ⚠ 親フラグ①を省略しない（子だけ生きてはならない・裁定25）。
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // ① 親：顧客リスト機能が off → 404（機能の存在自体を晒さない）。
  if (!isCustomerListEnabled()) {
    return jsonNoStore({ error: 'not_found' }, 404)
  }
  // ② 子：買い希望マッチが off → 404（FEATURE_BUYER_MATCH）。
  if (!isBuyerMatchEnabled()) {
    return jsonNoStore({ error: 'not_found' }, 404)
  }
  // ③ Platinum ガード（既存キー townAcquisitionPriority を流用・裁定62）。
  //    403 も rows と同様に本体を取り出して no-store で再ラップする（裁定64）。
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

  const { id: listId } = await params
  const supabase = await createSupabaseServerClient()

  // ⑤ 名簿の存在＆所有確認（RLS: 自分の org の行のみ SELECT 可）。既存3ルートと同型。
  const { data: list } = await supabase
    .from('customer_lists')
    .select('id')
    .eq('id', listId)
    .maybeSingle()
  if (!list) {
    return jsonNoStore({ error: 'not_found' }, 404)
  }

  // ⑥ RPC 呼び出し。school_district_id は cards では常に null（裁定67）。
  //    失敗は 500・RPC のメッセージは返さない（裁定63）。
  const { data, error } = await supabase.rpc('get_buyer_match_cards', {
    p_list_id: listId,
    p_muni_code_5: parsed.params.muniCode5,
    p_school_district_id: null,
    p_property_type: parsed.params.propertyType,
    p_price_min: parsed.params.priceMin,
    p_price_max: parsed.params.priceMax,
  })
  if (error) {
    return jsonNoStore({ error: 'fetch_failed' }, 500)
  }

  // 裁定60/66: RPC が返す jsonb を無改変で透過する（summary と同型・{id,rows}で包まない・
  //   stage / matched_count / cards を加工しない）。
  return jsonNoStore(data ?? {}, 200)
}

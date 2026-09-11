import type { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { guardFeature } from '@/lib/subscription'
import { isCustomerListEnabled } from '@/lib/customer-list/server'
import { isBuyerMatchEnabled } from '@/lib/server/feature-flags'
import { parseAreasSchoolType } from '@/app/api/customer-lists/[id]/areas/school-type'
import { jsonNoStore } from '@/lib/buyer-match/http'

export const runtime = 'nodejs'

// 取込エリア一覧の1行（画面表示用）。RPC get_customer_list_areas の返り列そのまま。
//   ★索引であって集計ではない（生件数は返らない設計）。件数の列は足さない。
interface AreaRow {
  muni_code_5: string
  muni_name: string
  prefecture_name: string | null
  has_school_districts: boolean
}

// GET /api/buyer-match/areas?school_type=elementary
//
//   踏襲元: src/app/api/customer-lists/[id]/areas/route.ts
//   list_id を持たない org スコープ版（BM-10b）。
//   ⚠ 踏襲元ルートには ② isBuyerMatchEnabled() が無いが、本ルートは
//   /api/buyer-match 配下の新設であるため summary/cards と並びを揃えて
//   ② を含める（裁定-bm-K）。異なるのはこの点と、⑤（名簿存在確認）を省略する点。
//     ① isCustomerListEnabled() off → 404
//     ② isBuyerMatchEnabled() off   → 404
//     ③ guardFeature('townAcquisitionPriority') → 403（denied.json() を no-store で再ラップ）
//     ④ school_type 検証 → 400（allowlist 外）
//     -- ⑤ 名簿存在確認は対象なしのため省略（裁定-bm-G）
//     ⑥ RPC 呼び出し（get_customer_list_areas）→ 500（RPC のメッセージは返さない）
//   ⛔ 名簿索引の既存 areas ルート（customer-lists/[id]/areas）は触らない。
//     school_type のパーサ（parseAreasSchoolType）は無改変で再利用する。
export async function GET(request: NextRequest) {
  // ① 親：顧客リスト機能が off → 404。
  if (!isCustomerListEnabled()) {
    return jsonNoStore({ error: 'not_found' }, 404)
  }
  // ② 子：買い希望マッチが off → 404（FEATURE_BUYER_MATCH・裁定-bm-K）。
  if (!isBuyerMatchEnabled()) {
    return jsonNoStore({ error: 'not_found' }, 404)
  }
  // ③ Platinum ガード（既存キー townAcquisitionPriority を流用）。
  const denied = await guardFeature('townAcquisitionPriority')
  if (denied) {
    const body = await denied.json()
    return jsonNoStore(body, denied.status)
  }

  // ④ school_type 検証（allowlist 外は入口で弾く。RPC 側も空を返すが二重防御）。
  const schoolType = parseAreasSchoolType(request.nextUrl.searchParams.get('school_type'))
  if (schoolType === null) {
    return jsonNoStore({ error: 'invalid_parameter', parameter: 'school_type' }, 400)
  }

  const supabase = await createSupabaseServerClient()

  // ⑥ RPC 呼び出し。p_list_id は常に null（org スコープ・BM-10a）。
  const { data, error } = await supabase.rpc('get_customer_list_areas', {
    p_list_id: null,
    p_school_type: schoolType,
  })
  if (error) {
    return jsonNoStore({ error: 'fetch_failed' }, 500)
  }

  // ⛔ ここで生件数の列を足さない。RPC の返り値をそのまま返す。
  const areas = (data ?? []) as AreaRow[]
  return jsonNoStore({ school_type: schoolType, areas }, 200)
}

import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { guardFeature } from '@/lib/subscription'
import { isCustomerListEnabled } from '@/lib/customer-list/server'
import { parseAreasSchoolType } from './school-type'

export const runtime = 'nodejs'

// 取込エリア一覧の1行（画面表示用）。RPC get_customer_list_areas の返り列そのまま。
//   ★索引であって集計ではない（生件数は返らない設計）。件数の列は足さない。
interface AreaRow {
  muni_code_5: string
  muni_name: string
  prefecture_name: string | null
  has_school_districts: boolean
}

// GET /api/customer-lists/[id]/areas?school_type=elementary  （M2-6b / SD-44）
//   顧客リストが当たった自治体の索引一覧を、RPC の ORDER BY(prefecture_code, city_code)
//   のまま返す。認可は guardFeature('townAcquisitionPriority') / RLS / RPC 内
//   current_user_plan() の多層で担保する。★service_role は使わない
//   （RLS と plan 判定を効かせるため）。
//   ガード順は school-district-ranking/route.ts と同一:
//     isCustomerListEnabled() ⇒ 404 → guardFeature(...) → params 検証。
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isCustomerListEnabled()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  // ★キーは attack-list / school-district-ranking と同一（新しい entitlement キーは作らない）。
  const denied = await guardFeature('townAcquisitionPriority')
  if (denied) return denied

  const { id: listId } = await params
  const schoolType = parseAreasSchoolType(request.nextUrl.searchParams.get('school_type'))
  if (schoolType === null) {
    // allowlist 外は入口で弾く（RPC 側も空を返すが二重防御）。
    return NextResponse.json(
      { error: 'school_type は elementary / junior_high のみです' },
      { status: 400 },
    )
  }

  const supabase = await createSupabaseServerClient()

  // 名簿の存在＆所有確認（RLS: 自分の org の行のみ SELECT 可）。
  const { data: list } = await supabase
    .from('customer_lists')
    .select('id, name')
    .eq('id', listId)
    .maybeSingle()
  if (!list) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // RPC 呼び出し。SECURITY INVOKER なので、このユーザーセッションで RLS・
  //   current_user_plan() がそのまま効く（＝認可の要）。
  const { data, error } = await supabase.rpc('get_customer_list_areas', {
    p_list_id: listId,
    p_school_type: schoolType,
  })
  if (error) {
    // 内部情報を漏らさないよう丸める（school-district-ranking と同じ流儀）。
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 })
  }

  // ⛔ ここで生件数の列を足さない。RPC の返り値をそのまま返す。
  const areas = (data ?? []) as AreaRow[]
  return NextResponse.json({
    id: list.id,
    name: list.name,
    school_type: schoolType,
    areas,
  })
}

import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { guardFeature } from '@/lib/subscription'
import { isCustomerListEnabled } from '@/lib/customer-list/server'
import { isSchoolType } from '@/lib/school-districts'

export const runtime = 'nodejs'

// 校区ランキング1行（画面表示用）。RPC get_school_district_heatmap の返り列そのまま。
//   ★生件数は返らない設計（k=5 抑止・4段階の相対濃淡のみ）。件数の列は足さない。
interface RankingRow {
  school_district_id: string
  school_name: string
  muni_code_5: string
  muni_name: string
  tier: number // smallint 1..4
  attribution_text: string | null
}

// GET /api/customer-lists/[id]/school-district-ranking?school_type=elementary
//   顧客リストの反響を校区ごとに集計した4段階(tier)の濃淡を、RPC の
//   ORDER BY(tier desc, muni_name, school_name)のまま返す（SD-42）。
//   認可は guardFeature('townAcquisitionPriority') / RLS / RPC 内 current_user_plan()
//   の多層で担保する。★service_role は使わない（RLS と plan 判定を効かせるため）。
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isCustomerListEnabled()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  // ★キーは attack-list/route.ts と同一（新しい entitlement キーは作らない）。
  const denied = await guardFeature('townAcquisitionPriority')
  if (denied) return denied

  const { id: listId } = await params
  const schoolType = request.nextUrl.searchParams.get('school_type') ?? 'elementary'
  if (!isSchoolType(schoolType)) {
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

  // RPC 呼び出し。p_mode は既定 'sell' に委ねる（渡さない）。
  //   RPC は SECURITY INVOKER なので、このユーザーセッションで RLS・current_user_plan()
  //   がそのまま効く（＝認可の要）。
  const { data, error } = await supabase.rpc('get_school_district_heatmap', {
    p_list_id: listId,
    p_school_type: schoolType,
  })
  if (error) {
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 })
  }

  // ⛔ ここで生件数の列を足さない・順位番号を付けない。RPC の返り値をそのまま返す。
  const rows = (data ?? []) as RankingRow[]
  return NextResponse.json({
    id: list.id,
    name: list.name,
    school_type: schoolType,
    rows,
  })
}

import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { isSchoolType } from '@/lib/school-districts'

// GET /api/school-districts
//   M2-0 / SD-27・SD-29・SD-30。学区図オーバーレイのデータ取得。
//   認可: 認証必須（401）。SD-30 により全プラン表示のため guardFeature は付けない。
//   公開/非公開の遮断は RLS(school_districts_select_public / is_public=true)が唯一の真実源。
//
//   2モード:
//   1) ?availability=1
//      → 公開されている (muni_code_5, school_type) 一覧（dedupe 済み）を返す。
//        列限定 SELECT（muni_code_5, school_type のみ）。RLS が公開行に絞る（D1案(c)）。
//        セッション1回だけ取得しトグルの disabled 前置判定に使う（8市ハードコードなし）。
//   2) ?muni_code_5=23211&school_type=elementary
//      → RPC get_school_districts_geojson で FeatureCollection を返す。
//        RPC は SECURITY INVOKER なので RLS がそのまま効く。

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()

  // ── 認証必須（SD-30: プラン錠なし＝guardFeature は付けない）──
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
  }

  const params = request.nextUrl.searchParams

  // ── モード1: availability（公開ペア一覧）──
  if (params.get('availability') === '1') {
    const { data, error } = await supabase
      .from('school_districts')
      .select('muni_code_5, school_type') // RLS が is_public=true 行のみに絞る
    if (error) {
      return NextResponse.json({ error: '公開状況の取得に失敗しました' }, { status: 500 })
    }
    const seen = new Set<string>()
    const pairs: Array<{ muni_code_5: string; school_type: string }> = []
    for (const row of data ?? []) {
      const key = `${row.muni_code_5}:${row.school_type}`
      if (seen.has(key)) continue
      seen.add(key)
      pairs.push({ muni_code_5: row.muni_code_5, school_type: row.school_type })
    }
    return NextResponse.json({ pairs })
  }

  // ── モード2: geojson（選択中の市区町村×校種）──
  const muniCode5 = params.get('muni_code_5')
  const schoolType = params.get('school_type')
  if (!muniCode5) {
    return NextResponse.json({ error: 'muni_code_5 が必要です' }, { status: 400 })
  }
  if (!isSchoolType(schoolType)) {
    // allowlist 外は入口で弾く（RPC 側も空を返すが二重防御）。
    return NextResponse.json(
      { error: 'school_type は elementary / junior_high のみです' },
      { status: 400 },
    )
  }

  const { data, error } = await supabase.rpc('get_school_districts_geojson', {
    p_muni_code_5: muniCode5,
    p_school_type: schoolType,
  })
  if (error) {
    return NextResponse.json({ error: '学区データの取得に失敗しました' }, { status: 500 })
  }
  // RPC は FeatureCollection(jsonb) を返す。null 時は空へフォールバック。
  return NextResponse.json(data ?? { type: 'FeatureCollection', features: [] })
}

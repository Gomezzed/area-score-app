import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getUserPlan } from '@/lib/subscription'
import { canUse } from '@/lib/plans'
import { decryptToken } from '@/lib/server/token-crypto'
import {
  refreshAccessToken,
  InvalidGrantError,
} from '@/lib/server/google-oauth'
import { createAreaScoreSpreadsheet } from '@/lib/server/google-sheets'
import { fetchMunicipalityExportData } from '@/lib/server/municipality-export'
import {
  MUNICIPALITY_EXPORT_HEADERS,
  municipalityExportRows,
} from '@/lib/export-columns'

export const runtime = 'nodejs'

// POST /api/export/sheets
//   Body: { prefecture_name_en }
//   処理順（厳守）:
//     ① セッション確認
//     ② サーバー側プラン判定（Standard 以上・canExportSheets。下位/free は 403）
//     ③ user_integrations から復号 → refresh_token で access_token 取得
//        （invalid_grant 時は行削除し 409 { error: 'reconnect_required' }）
//     ④ body 検証 → サーバー側でユーザースコープクライアントから該当都道府県の
//        市区町村を再取得（クライアントから渡されたデータは一切使わない）
//     ⑤ Sheets へ新規作成 → 値書込（RAW）→ 先頭行 太字＋行固定 batchUpdate
//     ⑥ { url } を返す
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()

  // ① セッション確認
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // ② サーバー側プラン判定（許可判定は plans.ts の canUse に集約＝guardFeature と同作法）
  const plan = await getUserPlan(user.id)
  if (!canUse(plan, 'canExportSheets')) {
    return NextResponse.json(
      { error: 'forbidden', requiredFeature: 'canExportSheets', plan },
      { status: 403 },
    )
  }

  // ③ 連携トークン → access_token
  const { data: integ } = await supabase
    .from('user_integrations')
    .select('refresh_token_enc')
    .eq('user_id', user.id)
    .eq('provider', 'google')
    .maybeSingle()

  if (!integ?.refresh_token_enc) {
    // 未接続。UI 側は再接続導線で authorize へ誘導する。
    return NextResponse.json({ error: 'reconnect_required' }, { status: 409 })
  }

  let accessToken: string
  try {
    accessToken = await refreshAccessToken(decryptToken(integ.refresh_token_enc))
  } catch (e) {
    if (e instanceof InvalidGrantError) {
      // 失効。行を削除し再接続を促す。
      await supabase
        .from('user_integrations')
        .delete()
        .eq('user_id', user.id)
        .eq('provider', 'google')
      return NextResponse.json({ error: 'reconnect_required' }, { status: 409 })
    }
    return NextResponse.json({ error: 'token_refresh_failed' }, { status: 502 })
  }

  // ④ body 検証 → サーバー側で市区町村を再取得
  const body = (await request.json().catch(() => null)) as
    | { prefecture_name_en?: unknown }
    | null
  const result = await fetchMunicipalityExportData(
    supabase,
    body?.prefecture_name_en,
  )
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  if (result.data.municipalities.length === 0) {
    return NextResponse.json(
      { error: '出力対象の市区町村がありません' },
      { status: 400 },
    )
  }

  // ⑤ Sheets 作成
  const dateStr = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const title = `エリアスコア_${result.data.prefectureName}_${dateStr}`
  const rows = municipalityExportRows(result.data.municipalities, {
    prefectureName: result.data.prefectureName,
  })

  let sheetUrl: string
  try {
    sheetUrl = await createAreaScoreSpreadsheet(
      accessToken,
      title,
      MUNICIPALITY_EXPORT_HEADERS,
      rows,
    )
  } catch {
    return NextResponse.json({ error: 'sheets_export_failed' }, { status: 502 })
  }

  // ⑥ URL 返却
  return NextResponse.json({ url: sheetUrl })
}

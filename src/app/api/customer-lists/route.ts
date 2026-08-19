import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { guardFeature } from '@/lib/subscription'
import { isCustomerListEnabled } from '@/lib/customer-list/server'

export const runtime = 'nodejs'

// POST /api/customer-lists
//   空の顧客名簿を1件だけ作成する（作成ステップ → アップロードステップの2段化・PR-E）。
//   Body(JSON): { name?: string }
//
//   処理順（厳守・既存ルート D77/D78 の二層封鎖をそのまま踏襲。新ルートだけ緩い、を作らない）:
//     ① サーバー側フィーチャーフラグ（off → 404・機能の存在ごと隠す）
//     ② guardFeature('townAcquisitionPriority')（未認証 401 / 非 platinum 403）
//        ★ Body 検証より前・DB アクセスより前が定位置
//     ③ セッション再確認（型の絞り込み）
//     ④ INSERT（RLS: cl_insert_org。WITH CHECK が user_id=auth.uid() を要求するため
//        user_id は auth.uid() を明示。organization_id / row_count / imported_at は
//        DB の DEFAULT に委ねる。⛔ service_role は使わない＝authenticated の RLS で通す）。
//
//   ⚠ 取込（住所突合・行の書き込み）は行わない。行の投入は [id]/import が受け持つ。
//      row_count は DEFAULT 0 のまま＝「取込未完了」を意味する（PR-E の擬似原子性）。
export async function POST(request: NextRequest) {
  // ① フィーチャーフラグ（UI と二層）。off なら存在ごと 404。
  if (!isCustomerListEnabled()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // ② platinum 認可。判定は guardFeature に一任し、返る 401/403 をそのまま返す
  //    （認可は緩めない・レスポンス整形もしない）。
  const denied = await guardFeature('townAcquisitionPriority')
  if (denied) return denied

  // ③ セッション再確認（guardFeature 通過済だが型の絞り込みのため）。
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Body 検証（name は任意。未入力は既存ルートと同じ既定名にフォールバック）。
  let body: { name?: unknown }
  try {
    body = await request.json()
  } catch {
    // Body 無し / 不正 JSON は空オブジェクト扱い（name 省略と同義）。
    body = {}
  }
  const name =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 200)
      : '顧客名簿'

  // ④ INSERT（RLS: cl_insert_org）。
  //    user_id は WITH CHECK（user_id = auth.uid()）を満たすため明示セット。
  //    organization_id は DEFAULT（default_org_id()）に委ねる＝current_user_org_ids() の
  //    部分集合のため RLS を必ず通る（PM 実測）。row_count / imported_at も DEFAULT に委ねる。
  const { data: list, error } = await supabase
    .from('customer_lists')
    .insert({
      user_id: user.id,
      name,
      source_type: 'csv',
    })
    .select('id, name, row_count')
    .single()

  if (error || !list) {
    return NextResponse.json({ error: 'create_failed' }, { status: 500 })
  }

  return NextResponse.json(
    { ok: true, id: list.id, name: list.name, row_count: list.row_count },
    { status: 201 },
  )
}

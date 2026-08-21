import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { guardFeature } from '@/lib/subscription'
import { isCustomerListEnabled } from '@/lib/customer-list/server'
import { presetChoiceFromMapping } from '@/lib/customer-list/preset-choice'

export const runtime = 'nodejs'

// GET /api/customer-lists
//   org 内で共有される顧客名簿の一覧を返す（PR-F・一覧導線／SD-3 の org 共有読み取り）。
//   返す各要素: { id, name, row_count, imported_at, is_owner, preset }
//     - row_count  : 保存列をそのまま返す（customer_list_rows を数え直さない）。
//     - imported_at: 「最終取込」。取込成功のたびに更新される列（初回作成日ではない・原則1）。
//     - is_owner   : 作成者(user_id)== 現ユーザー か。⚠ これは D108 の「表示上の」操作可否に
//        使う UI ヒントであって認可ではない。認可は RLS / API 403(not_list_owner) が別に持つ
//        （原則12）。⛔ 生の user_id は返さない（他ユーザーの id を露出しない）。
//     - preset     : 前回の CSV 形式選択を復元するための導出値（''/'hausudo'/'other'）。
//        column_mapping(v:2) からサーバー側で導出して返す。⛔ 生の column_mapping（他ユーザーの
//        CSV ヘッダ名を含む）は返さない＝データ最小化（is_owner と同じ方針）。
//
//   処理順は POST と同一（新ルートだけ緩い、を作らない）:
//     ① フィーチャーフラグ（off → 404）
//     ② guardFeature('townAcquisitionPriority')（未認証 401 / 非 platinum 403）★パラメータ検証より前
//     ③ セッション再確認（is_owner 計算に user.id が要るため）
//     ④ SELECT（RLS: cl_select_org が org 共有読み取りを担保。⛔ 認可は緩めない）。
//        並びは imported_at DESC（index customer_lists_user_idx / 既定=最終取込の降順）。
export async function GET() {
  // ① フィーチャーフラグ（UI と二層）。off なら存在ごと 404。
  if (!isCustomerListEnabled()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // ② platinum 認可。判定は guardFeature に一任し、返る 401/403 をそのまま返す。
  const denied = await guardFeature('townAcquisitionPriority')
  if (denied) return denied

  // ③ セッション再確認（guardFeature 通過済だが is_owner 計算のため user.id を取る）。
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // ④ SELECT（RLS: cl_select_org＝org 共有読み取り）。user_id は is_owner の計算にのみ使い、
  //    レスポンスには載せない。並びは imported_at 降順（最終取込の新しい順）。
  const { data, error } = await supabase
    .from('customer_lists')
    .select('id, name, row_count, imported_at, user_id, column_mapping')
    .order('imported_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 })
  }

  const lists = (data ?? []).map((l) => ({
    id: l.id as string,
    name: l.name as string,
    row_count: l.row_count as number,
    imported_at: l.imported_at as string,
    is_owner: l.user_id === user.id,
    // 前回の CSV 形式選択を復元（v:2 column_mapping から導出）。⛔ 生の mapping は返さない。
    preset: presetChoiceFromMapping(l.column_mapping),
  }))

  return NextResponse.json({ ok: true, lists })
}

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

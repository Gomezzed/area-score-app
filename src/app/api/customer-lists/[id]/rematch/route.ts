import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { guardFeature } from '@/lib/subscription'
import { isCustomerListEnabled } from '@/lib/customer-list/server'
import { normalizeJpAddress } from '@/lib/address/normalize-jp'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  elapsedMsSince,
  requestIdHeader,
  failEnvelope,
  reportImportError,
  type Timings,
} from '@/lib/customer-list/api-envelope'

export const runtime = 'nodejs'

// PostgREST の 1 リクエスト上限（既定 1000 行）を跨いでページ取得する。
//   1 リスト上限は MAX_ROWS=5,000 のため、最大 5 ページで収まる（安全弁は多めに 20）。
const PAGE = 1000
const MAX_PAGES = 20

// 取り込み処理の段階識別子（import と同じ観測性の流儀）。
type RematchStage = 'guardFeature' | 'auth' | 'list' | 'load' | 'match'

// POST /api/customer-lists/[id]/rematch
//   既存の取込済み行（deleted_at IS NULL）を CSV 無しで再突合する（PR-D改 c4）。
//   突合は import と同一の DB バッチ RPC match_customer_list_rows（service_role・DEFINER）を
//   再利用し、当該リストの突合結果を洗い替え（delete→insert）する（裁定B）。
//
//   ⛔ 認可は import ルートと同型・同順で、403 判定を一切緩めない:
//     ① feature flag off → 404（機能の存在ごと隠す）
//     ② guardFeature('townAcquisitionPriority') → 未認証 401 / 非 platinum 403
//     ③ セッション再確認
//     ④ 名簿の存在（404）と取込者本人であること（403・作成者ガード）
//   突合の書き込み自体は service_role だが、それに到達する前に本人性を必ず確認する。
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID()
  const startedAt = performance.now()
  const timings: Timings<RematchStage> = {}

  // ① フィーチャーフラグ（import と二層で揃える）。off なら存在ごと 404。
  if (!isCustomerListEnabled()) {
    return NextResponse.json(
      { error: 'not_found' },
      { status: 404, headers: requestIdHeader(requestId) },
    )
  }

  // ② platinum 認可（判定は guardFeature に一任し status を保持・緩めない）。
  const gStart = performance.now()
  const denied = await guardFeature('townAcquisitionPriority')
  timings.guardFeature = elapsedMsSince(gStart)
  if (denied) {
    const code = denied.status === 401 ? 'unauthorized' : 'feature_disabled'
    return failEnvelope(denied.status, 'guardFeature', code, requestId, timings, startedAt)
  }

  // ③ セッション再確認。
  const aStart = performance.now()
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  timings.auth = elapsedMsSince(aStart)
  if (!user) {
    return failEnvelope(401, 'auth', 'unauthorized', requestId, timings, startedAt)
  }

  // ④ 名簿の存在・所有確認（作成者本人のみ・import ④ と同じ 403）。
  const { id: listId } = await params
  const lStart = performance.now()
  const { data: list, error: listErr } = await supabase
    .from('customer_lists')
    .select('id, user_id')
    .eq('id', listId)
    .maybeSingle()
  timings.list = elapsedMsSince(lStart)
  if (listErr) {
    reportImportError(listErr, { requestId, stage: 'list', timings })
    return failEnvelope(500, 'list', 'list_lookup_failed', requestId, timings, startedAt)
  }
  if (!list) {
    return NextResponse.json(
      { error: 'not_found' },
      { status: 404, headers: requestIdHeader(requestId) },
    )
  }
  if (list.user_id !== user.id) {
    return failEnvelope(403, 'list', 'not_list_owner', requestId, timings, startedAt)
  }

  // ⑤ 現存行（deleted_at IS NULL）の id と生住所を読む（RLS で自分の行のみ）。
  const loadStart = performance.now()
  const rows: Array<{ id: string; address_raw: string | null }> = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE
    const { data, error } = await supabase
      .from('customer_list_rows')
      .select('id, address_raw')
      .eq('list_id', listId)
      .is('deleted_at', null)
      .range(from, from + PAGE - 1)
    if (error) {
      timings.load = elapsedMsSince(loadStart)
      reportImportError(error, { requestId, stage: 'load', timings })
      return failEnvelope(500, 'load', 'rows_load_failed', requestId, timings, startedAt)
    }
    if (!data || data.length === 0) break
    rows.push(...(data as Array<{ id: string; address_raw: string | null }>))
    if (data.length < PAGE) break
  }
  timings.load = elapsedMsSince(loadStart)

  // ⑥ 住所を (muni_code_5, town, chome, ban, go) に分解して突合バッチ RPC へ渡す。
  //    突合は import と同一経路（service_role・DEFINER・洗い替え・fail-soft）を再利用する。
  const mStart = performance.now()
  const admin = getSupabaseAdmin()
  if (!admin) {
    // 再突合は突合そのものが目的のため、service_role 未設定は 500 とする
    //    （import では派生処理のためスキップ可だが、ここでは処理が成立しない）。
    reportImportError(new Error('supabase admin client unavailable'), {
      requestId,
      stage: 'match',
      timings,
    })
    timings.match = elapsedMsSince(mStart)
    return failEnvelope(500, 'match', 'match_unavailable', requestId, timings, startedAt)
  }

  const pRows = rows.map((r) => {
    const norm = normalizeJpAddress(r.address_raw ?? '')
    return {
      row_id: r.id,
      muni_code_5: norm.muniCode5,
      town: norm.town,
      chome: norm.chome,
      ban: norm.ban,
      go: norm.go,
    }
  })

  const { data: matchSummary, error: matchErr } = await admin.rpc(
    'match_customer_list_rows',
    { p_list_id: listId, p_rows: pRows },
  )
  timings.match = elapsedMsSince(mStart)
  if (matchErr) {
    reportImportError(matchErr, { requestId, stage: 'match', timings })
    return failEnvelope(500, 'match', 'match_failed', requestId, timings, startedAt)
  }

  return NextResponse.json(
    {
      ok: true,
      id: listId,
      rows: rows.length,
      match: matchSummary,
      requestId,
      timings,
    },
    { headers: requestIdHeader(requestId) },
  )
}

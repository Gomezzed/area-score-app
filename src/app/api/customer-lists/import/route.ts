import { NextResponse, type NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { guardFeature } from '@/lib/subscription'
import {
  parseCsv,
  detectColumnMapping,
  cellOf,
  parseDateLoose,
} from '@/lib/customer-list/csv-import'
import {
  matchAddress,
  buildTownIndex,
  resolveMunicipalityIds,
} from '@/lib/customer-list/match'
import {
  isCustomerListEnabled,
  loadMunicipalities,
  loadTownData,
  CustomerListDbError,
  type MuniAsOf,
} from '@/lib/customer-list/server'
import type { TownIndex } from '@/lib/customer-list/match'
import type { CustomerColumnKey } from '@/lib/customer-list/types'

export const runtime = 'nodejs'

// 取り込み上限（原則: 一気にやらない・サービス保護）。
const MAX_ROWS = 5000
// 行 INSERT のバッチ分割サイズ。
const INSERT_CHUNK = 500

// 取り込み処理の段階識別子（観測性: どこで失敗したかを機械可読に示す）。
type ImportStage =
  | 'guardFeature'
  | 'auth'
  | 'loadMunicipalities'
  | 'prescan'
  | 'loadTownData'
  | 'insert'

type Timings = Partial<Record<ImportStage, number>>

// 経過ミリ秒（整数）。performance.now() は node ランタイムのグローバル。
function elapsedMsSince(start: number): number {
  return Math.round(performance.now() - start)
}

// 全レスポンスに付与する追跡ヘッダ（サポート時に requestId を突合できる）。
function requestIdHeader(requestId: string): Record<string, string> {
  return { 'x-request-id': requestId }
}

// 失敗レスポンス（観測性エンベロープ）。
//   ⛔ クライアントには stage/code など機械可読な最小情報のみ返す。
//      detail / Supabase 生メッセージ / SQL / スキーマ名は一切含めない。
function failEnvelope(
  status: number,
  stage: ImportStage,
  code: string,
  requestId: string,
  timings: Timings,
  startedAt: number,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      stage,
      code,
      elapsedMs: elapsedMsSince(startedAt),
      requestId,
      timings,
    },
    { status, headers: requestIdHeader(requestId) },
  )
}

// PostgrestError / CustomerListDbError から SQLSTATE 等を取り出す（Sentry 専用）。
function pgFieldsOf(error: unknown): {
  code?: string
  message?: string
  details?: string
  hint?: string
} | null {
  if (error instanceof CustomerListDbError) return error.pg
  if (error && typeof error === 'object' && 'message' in error) {
    const e = error as {
      code?: string
      message?: string
      details?: string
      hint?: string
    }
    return {
      code: e.code,
      message: e.message,
      details: e.details,
      hint: e.hint,
    }
  }
  return null
}

// 例外を Sentry にだけ送る（握りつぶし禁止・全 catch から必ず呼ぶ）。
//   ⚠ Fluid Compute はインスタンスを並行リクエストで再利用するため、
//      グローバル setTag だとタグが他リクエストへ漏れる。withScope でイベント単位に閉じる。
function reportImportError(
  error: unknown,
  ctx: { requestId: string; stage: ImportStage; timings: Timings },
): void {
  const pg = pgFieldsOf(error)
  Sentry.withScope((scope) => {
    scope.setTag('import_stage', ctx.stage)
    if (pg?.code) scope.setTag('pg_code', pg.code)
    scope.setContext('import', {
      requestId: ctx.requestId,
      stage: ctx.stage,
      timings: ctx.timings,
      pgMessage: pg?.message ?? null,
      pgHint: pg?.hint ?? null,
      pgDetails: pg?.details ?? null,
    })
    Sentry.captureException(error)
  })
}

// POST /api/customer-lists/import
//   Body(JSON): { csv: string, name?: string }
//   処理順（厳守）:
//     ① サーバー側フィーチャーフラグ（off → 404・機能を隠す）
//     ② セッション + platinum 認可（guardFeature 同作法・二層封鎖の内側）
//     ③ CSV パース → 列マッピング自動検出（住所列必須）
//     ④ town_monthly_metrics から突合インデックスを構築し各行を突合
//     ⑤ customer_lists / customer_list_rows へ INSERT（RLS: 自分の行のみ）
//     ⑥ { id, row_count, summary } を返す
export async function POST(request: NextRequest) {
  // 観測性: 1リクエスト = 1 requestId。全レスポンスの x-request-id ヘッダにも載せる。
  const requestId = crypto.randomUUID()
  const startedAt = performance.now()
  const timings: Timings = {}

  // ① サーバー側フィーチャーフラグ（UI と二層）。off なら存在ごと 404。
  //    機能の存在自体を隠すため、段階識別子・診断情報は返さない（意図的に最小）。
  if (!isCustomerListEnabled()) {
    return NextResponse.json(
      { error: 'not_found' },
      { status: 404, headers: requestIdHeader(requestId) },
    )
  }

  // ② platinum 認可（未認証 401 / 非platinum 403）。町域取得優先＝platinum専用。
  //    判定は guardFeature に一任し、status（401/403）はその決定をそのまま保持する
  //    （認可は緩めない・レスポンス整形のみ）。否認は例外ではなく正常系の制御。
  const gStart = performance.now()
  const denied = await guardFeature('townAcquisitionPriority')
  timings.guardFeature = elapsedMsSince(gStart)
  if (denied) {
    const code = denied.status === 401 ? 'unauthorized' : 'feature_disabled'
    return failEnvelope(
      denied.status,
      'guardFeature',
      code,
      requestId,
      timings,
      startedAt,
    )
  }

  // ③ セッション再確認（guardFeature 通過済だが型の絞り込みのため）。
  const aStart = performance.now()
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  timings.auth = elapsedMsSince(aStart)
  if (!user) {
    return failEnvelope(401, 'auth', 'unauthorized', requestId, timings, startedAt)
  }

  // Body 検証 → CSV パース（段階ではなく入力検証。既知の 400 は具体的コードで返す。
  //   invalid_json 等は想定内のクライアント入力エラーのため Sentry には送らない）。
  let body: { csv?: unknown; name?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_json' },
      { status: 400, headers: requestIdHeader(requestId) },
    )
  }
  const csvText = typeof body.csv === 'string' ? body.csv : ''
  if (!csvText.trim()) {
    return NextResponse.json(
      { error: 'empty_csv' },
      { status: 400, headers: requestIdHeader(requestId) },
    )
  }
  const listName =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 200)
      : '顧客名簿'

  const rows = parseCsv(csvText)
  if (rows.length < 2) {
    return NextResponse.json(
      { error: 'no_data_rows' },
      { status: 400, headers: requestIdHeader(requestId) },
    )
  }
  const header = rows[0]
  const dataRows = rows.slice(1)
  if (dataRows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: 'too_many_rows', max: MAX_ROWS, got: dataRows.length },
      { status: 400, headers: requestIdHeader(requestId) },
    )
  }

  const mapping = detectColumnMapping(header)
  if (mapping.address == null) {
    return NextResponse.json(
      { error: 'address_column_not_found', header },
      { status: 400, headers: requestIdHeader(requestId) },
    )
  }

  // ④ 突合インデックス構築（全取得の廃止・statement timeout 対策）。段階別に計測し、
  //    どの段階の DB エラーかを機械可読な code で切り分ける（旧実装は全て
  //    town_index_unavailable に潰していた）。構築失敗時は customer_lists / rows へ
  //    一切書き込まない（ゴミデータ禁止・fail closed）。HTTP status は現状どおり 500。
  const addresses = dataRows.map((row) => cellOf(row, mapping, 'address'))

  // ④-1 loadMunicipalities（住所→自治体の解決母集合）。
  let municipalities: Awaited<ReturnType<typeof loadMunicipalities>>
  const mStart = performance.now()
  try {
    municipalities = await loadMunicipalities(supabase)
    timings.loadMunicipalities = elapsedMsSince(mStart)
  } catch (error) {
    timings.loadMunicipalities = elapsedMsSince(mStart)
    reportImportError(error, { requestId, stage: 'loadMunicipalities', timings })
    return failEnvelope(
      500,
      'loadMunicipalities',
      'municipalities_unavailable',
      requestId,
      timings,
      startedAt,
    )
  }

  // ④-2 prescan（住所→自治体候補の解決・純CPU）。
  //    複数候補（府中市問題等）でも全候補の町域データを後段で取得する（取りこぼし防止）。
  let matchedIds: string[]
  const pStart = performance.now()
  try {
    const muniIndex = buildTownIndex([], municipalities)
    const ids = new Set<string>()
    for (const a of addresses) {
      for (const id of resolveMunicipalityIds(a, muniIndex)) ids.add(id)
    }
    matchedIds = Array.from(ids)
    timings.prescan = elapsedMsSince(pStart)
  } catch (error) {
    timings.prescan = elapsedMsSince(pStart)
    reportImportError(error, { requestId, stage: 'prescan', timings })
    return failEnvelope(
      500,
      'prescan',
      'prescan_failed',
      requestId,
      timings,
      startedAt,
    )
  }

  // ④-3 loadTownData（解決済み id のみ .in() で取得）＋突合インデックス構築。
  //    ここが本障害（S6）の発生点: ビュー列不整合で PostgREST 42703 → throw。
  let index: TownIndex
  let muniAsOf: MuniAsOf[]
  const lStart = performance.now()
  try {
    const { records, muniAsOf: asOf } = await loadTownData(supabase, matchedIds)
    index = buildTownIndex(records, municipalities)
    muniAsOf = asOf
    timings.loadTownData = elapsedMsSince(lStart)
  } catch (error) {
    timings.loadTownData = elapsedMsSince(lStart)
    reportImportError(error, { requestId, stage: 'loadTownData', timings })
    return failEnvelope(
      500,
      'loadTownData',
      'town_index_unavailable',
      requestId,
      timings,
      startedAt,
    )
  }

  // 各行を突合。電話番号は取り込むが保存しない（列に含めない・個人情報最小化）。
  let confirmed = 0
  let ambiguous = 0
  let outOfScope = 0

  const rowInserts = dataRows.map((row, i) => {
    const addressRaw = addresses[i]
    const m = matchAddress(addressRaw, index)
    if (m.status === 'confirmed') confirmed++
    else if (m.status === 'ambiguous') ambiguous++
    else outOfScope++

    return {
      user_id: user.id,
      row_no: i + 1,
      customer_name: emptyToNull(cellOf(row, mapping, 'customer_name')),
      address_raw: emptyToNull(addressRaw),
      address_normalized: emptyToNull(m.address_normalized),
      municipality_id: m.municipality_id,
      town_name_normalized: m.town_name_normalized,
      match_status: m.status,
      match_candidates: m.candidates.length > 0 ? m.candidates : null,
      inquiry_at: parseDateLoose(cellOf(row, mapping, 'inquiry_at')),
      last_contact_at: parseDateLoose(cellOf(row, mapping, 'last_contact_at')),
      media: emptyToNull(cellOf(row, mapping, 'media')),
      category: emptyToNull(cellOf(row, mapping, 'category')),
      assignee: emptyToNull(cellOf(row, mapping, 'assignee')),
      // 電話（phone）は cellOf で取得可能だが、意図的に保存しない。
    }
  })

  // ⑤ 名簿本体＋行を INSERT（RLS: cl_insert_own / clr_insert_own）。1 段階として計測。
  //    PostgrestError は throw しないため、error 分岐でも必ず Sentry へ送る（握りつぶし禁止）。
  const iStart = performance.now()
  const { data: list, error: listErr } = await supabase
    .from('customer_lists')
    .insert({
      user_id: user.id,
      name: listName,
      source_type: 'csv',
      row_count: dataRows.length,
      column_mapping: buildColumnMappingRecord(header, mapping),
    })
    .select('id')
    .single()

  if (listErr || !list) {
    timings.insert = elapsedMsSince(iStart)
    reportImportError(listErr ?? new Error('customer_lists insert returned no row'), {
      requestId,
      stage: 'insert',
      timings,
    })
    return failEnvelope(500, 'insert', 'insert_failed', requestId, timings, startedAt)
  }
  const listId = list.id as string

  // 行をバッチ INSERT（RLS: clr_insert_own）。失敗時は親を巻き戻す。
  for (let i = 0; i < rowInserts.length; i += INSERT_CHUNK) {
    const chunk = rowInserts
      .slice(i, i + INSERT_CHUNK)
      .map((r) => ({ ...r, list_id: listId }))
    const { error: rowsErr } = await supabase
      .from('customer_list_rows')
      .insert(chunk)
    if (rowsErr) {
      // 途中失敗は不整合を避けるため親ごと削除（ON DELETE CASCADE で行も消える）。
      await supabase.from('customer_lists').delete().eq('id', listId)
      timings.insert = elapsedMsSince(iStart)
      reportImportError(rowsErr, { requestId, stage: 'insert', timings })
      return failEnvelope(
        500,
        'insert',
        'insert_rows_failed',
        requestId,
        timings,
        startedAt,
      )
    }
  }
  timings.insert = elapsedMsSince(iStart)

  // ⑥ サマリを返す（突合基準の as_of を自治体別に含める）。成功時も requestId/timings を載せる。
  return NextResponse.json(
    {
      ok: true,
      id: listId,
      name: listName,
      row_count: dataRows.length,
      summary: { confirmed, ambiguous, out_of_scope: outOfScope },
      as_of_by_municipality: muniAsOf,
      requestId,
      timings,
    },
    { headers: requestIdHeader(requestId) },
  )
}

// 空文字は DB では null にする（未入力と空を同一視）。
function emptyToNull(s: string): string | null {
  return s && s.trim() ? s : null
}

// 検出したマッピングを「論理列 → 実ヘッダ名」の可読な形で保存する。
function buildColumnMappingRecord(
  header: string[],
  mapping: Partial<Record<CustomerColumnKey, number>>,
): Record<string, string> {
  const out: Record<string, string> = {}
  ;(Object.keys(mapping) as CustomerColumnKey[]).forEach((key) => {
    const idx = mapping[key]
    if (idx != null) out[key] = header[idx] ?? ''
  })
  return out
}

import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { guardFeature } from '@/lib/subscription'
import { decodeCsvBytes, CsvDecodeError } from '@/lib/customer-list/decode'
import { parseCsv } from '@/lib/customer-list/csv-import'
import {
  resolveColumnMapping,
  UnknownPresetError,
  type ResolveRoute,
} from '@/lib/customer-list/presets'
import { extractRows } from '@/lib/customer-list/row-extract'
import { planUpsert } from '@/lib/customer-list/upsert-plan'
import {
  matchAddress,
  buildTownIndex,
  resolveMunicipalityIds,
} from '@/lib/customer-list/match'
import {
  isCustomerListEnabled,
  loadMunicipalities,
  loadTownData,
  loadExistingExternalIds,
  upsertCustomerListRows,
  replaceUntrackedRows,
  markMissingRows,
  type MuniAsOf,
} from '@/lib/customer-list/server'
import {
  elapsedMsSince,
  requestIdHeader,
  failEnvelope,
  reportImportError,
  type Timings,
} from '@/lib/customer-list/api-envelope'
import type { TownIndex } from '@/lib/customer-list/match'
import type { MatchResult, ColumnMapping } from '@/lib/customer-list/types'

export const runtime = 'nodejs'

// 取り込み上限（原則: 一気にやらない・サービス保護）。v0 と同値。
const MAX_ROWS = 5000
// 生バイトの上限。5,000 行 × 174 列でも数 MB に収まる想定。
const MAX_BYTES = 10 * 1024 * 1024

// 取り込み処理の段階識別子（観測性: どこで失敗したかを機械可読に示す）。
type ImportStage =
  | 'guardFeature'
  | 'auth'
  | 'list'
  | 'decode'
  | 'parse'
  | 'loadMunicipalities'
  | 'prescan'
  | 'loadTownData'
  | 'upsert'
  | 'missing'

// POST /api/customer-lists/[id]/import
//   Body: CSV の **生バイト**（Content-Type: application/octet-stream）。
//     ⚠ JSON の文字列で受けない。ブラウザの File.text() は常に UTF-8 として解釈するため、
//        そこを通すと cp932(Shift_JIS) のバイト列が到達前に失われる（O44）。
//
//   処理順（厳守・v0 の二層封鎖 D77/D78 をそのまま踏襲。新ルートだけ緩い、を作らない）:
//     ① サーバー側フィーチャーフラグ（off → 404・機能の存在ごと隠す）
//     ② guardFeature('townAcquisitionPriority')（未認証 401 / 非 platinum 403）
//        ★ params 解決より前・DB アクセスより前が定位置
//     ③ セッション再確認
//     ④ 名簿の存在（404）と取込者本人であること（403・論点E / CL-31）
//     ⑤ デコード（UTF-8/BOM/cp932）→ パース → 抽出（PII は読み捨て・CL-32）
//     ⑥ 住所→町域 突合（v0 と同じエンジン）
//     ⑦ 毎回全件 UPSERT（CL-17・主キー UPSERT 方式）
//     ⑧ external_id を持たない行の全置換（論点B ③）
//     ⑨ 今回触られなかった行に missing_since を付与（PR-A 申し送り③）
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // 観測性: 1リクエスト = 1 requestId。全レスポンスの x-request-id ヘッダにも載せる。
  const requestId = crypto.randomUUID()
  const startedAt = performance.now()
  const timings: Timings<ImportStage> = {}

  // ① フィーチャーフラグ（UI と二層）。off なら存在ごと 404（診断情報は返さない）。
  if (!isCustomerListEnabled()) {
    return NextResponse.json(
      { error: 'not_found' },
      { status: 404, headers: requestIdHeader(requestId) },
    )
  }

  // ② platinum 認可。判定は guardFeature に一任し、status(401/403) をそのまま保持する
  //    （認可は緩めない・レスポンス整形のみ）。
  const gStart = performance.now()
  const denied = await guardFeature('townAcquisitionPriority')
  timings.guardFeature = elapsedMsSince(gStart)
  if (denied) {
    const code = denied.status === 401 ? 'unauthorized' : 'feature_disabled'
    return failEnvelope(denied.status, 'guardFeature', code, requestId, timings, startedAt)
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

  // ④ 名簿の存在・所有確認。
  //    RLS(cl_select_org) は同一 org 共有だが、書込（clr_insert_org/clr_update_org）は
  //    「作成者本人 AND org 一致」。他人の名簿へ再取込すると UPDATE 側で RLS に弾かれるため、
  //    API でも先に 403 を返して二重に締める（論点E・CL-31）。
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

  // ⑤-1 生バイトの受領とデコード。
  const dStart = performance.now()
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await request.arrayBuffer())
  } catch {
    timings.decode = elapsedMsSince(dStart)
    return failEnvelope(400, 'decode', 'invalid_body', requestId, timings, startedAt)
  }
  if (bytes.byteLength === 0) {
    timings.decode = elapsedMsSince(dStart)
    return failEnvelope(400, 'decode', 'empty_csv', requestId, timings, startedAt)
  }
  if (bytes.byteLength > MAX_BYTES) {
    timings.decode = elapsedMsSince(dStart)
    return failEnvelope(413, 'decode', 'file_too_large', requestId, timings, startedAt)
  }
  let text: string
  let encoding: string
  try {
    const decoded = decodeCsvBytes(bytes)
    text = decoded.text
    encoding = decoded.encoding
    timings.decode = elapsedMsSince(dStart)
  } catch (error) {
    timings.decode = elapsedMsSince(dStart)
    if (error instanceof CsvDecodeError) {
      // 想定内のクライアント入力エラー（UTF-16 等）。Sentry には送らない。
      return failEnvelope(
        400,
        'decode',
        'unsupported_encoding',
        requestId,
        timings,
        startedAt,
      )
    }
    reportImportError(error, { requestId, stage: 'decode', timings })
    return failEnvelope(500, 'decode', 'decode_failed', requestId, timings, startedAt)
  }

  // ⑤-2 パース → 列マッピング検出 → 抽出（PII は ExtractedRow のキーにも存在しない・CL-32）。
  const pStart = performance.now()
  const rows = parseCsv(text)
  if (rows.length < 2) {
    timings.parse = elapsedMsSince(pStart)
    return failEnvelope(400, 'parse', 'no_data_rows', requestId, timings, startedAt)
  }
  const dataRows = rows.slice(1)
  if (dataRows.length > MAX_ROWS) {
    timings.parse = elapsedMsSince(pStart)
    return failEnvelope(400, 'parse', 'too_many_rows', requestId, timings, startedAt)
  }
  // 列マッピング解決（ハイブリッド: 明示 ?preset → ヘッダ指紋 → 既存 heuristic）。
  //   ⛔ preset の読み取り/検証は必ず guardFeature 通過後（403 が 400 より先に返る順序を保つ）。
  //   ⛔ 未知の presetId は 400 で停止し、黙って heuristic にフォールバックしない（O49 回避）。
  const presetId = request.nextUrl.searchParams.get('preset')
  let resolved: ReturnType<typeof resolveColumnMapping>
  try {
    resolved = resolveColumnMapping(rows[0], presetId)
  } catch (error) {
    timings.parse = elapsedMsSince(pStart)
    if (error instanceof UnknownPresetError) {
      return failEnvelope(400, 'parse', 'unknown_preset', requestId, timings, startedAt)
    }
    reportImportError(error, { requestId, stage: 'parse', timings })
    return failEnvelope(500, 'parse', 'mapping_failed', requestId, timings, startedAt)
  }
  const { mapping, extract, route: resolveRoute } = resolved
  // 住所は複合列（都道府県+市区+住所）でも単一列でもよいが、どちらも無ければ突合できない。
  if (mapping.address == null && !(extract.addressColumns?.length)) {
    timings.parse = elapsedMsSince(pStart)
    return failEnvelope(
      400,
      'parse',
      'address_column_not_found',
      requestId,
      timings,
      startedAt,
    )
  }
  const extracted = extractRows(dataRows, mapping, extract)
  timings.parse = elapsedMsSince(pStart)

  // ⑥ 突合（v0 と同じ手順: 自治体母集合 → 候補解決 → 町域取得 → 行ごと突合）。
  //    構築失敗時は一切書き込まない（ゴミデータ禁止・fail closed）。
  const addresses = extracted.map((e) => e.address_raw ?? '')

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

  let matchedIds: string[]
  const preStart = performance.now()
  try {
    const muniIndex = buildTownIndex([], municipalities)
    const ids = new Set<string>()
    for (const a of addresses) {
      for (const id of resolveMunicipalityIds(a, muniIndex)) ids.add(id)
    }
    matchedIds = Array.from(ids)
    timings.prescan = elapsedMsSince(preStart)
  } catch (error) {
    timings.prescan = elapsedMsSince(preStart)
    reportImportError(error, { requestId, stage: 'prescan', timings })
    return failEnvelope(500, 'prescan', 'prescan_failed', requestId, timings, startedAt)
  }

  let index: TownIndex
  let muniAsOf: MuniAsOf[]
  const tStart = performance.now()
  try {
    const { records, muniAsOf: asOf } = await loadTownData(supabase, matchedIds)
    index = buildTownIndex(records, municipalities)
    muniAsOf = asOf
    timings.loadTownData = elapsedMsSince(tStart)
  } catch (error) {
    timings.loadTownData = elapsedMsSince(tStart)
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

  const matches: MatchResult[] = addresses.map((a) => matchAddress(a, index))
  const summary = { confirmed: 0, ambiguous: 0, out_of_scope: 0 }
  for (const m of matches) summary[m.status]++

  // ⑦〜⑨ 書き込み。段階は 'upsert' / 'missing' の 2 つで計測する。
  const uStart = performance.now()
  let missingMarked = 0
  let plan: ReturnType<typeof planUpsert>
  try {
    const existingByExternalId = await loadExistingExternalIds(supabase, listId)
    plan = planUpsert({
      listId,
      userId: user.id,
      extracted,
      matches,
      existingByExternalId,
      newId: () => crypto.randomUUID(),
      // プリセットが小学校区列を解決したときだけ desired_school を永続化する
      //   （汎用取込では列を含めず既存値を保全する）。
      persistDesiredSchool: extract.schoolColumn != null,
    })

    // ⑦ 追跡可能な行（external_id 有り）を毎回全件 UPSERT。
    const dbNow = await upsertCustomerListRows(supabase, plan.tracked)

    // ⑧ 追跡不能な行（external_id 無し）は当該 list の NULL 行だけを全置換（論点B ③）。
    await replaceUntrackedRows(supabase, listId, plan.untracked)
    timings.upsert = elapsedMsSince(uStart)

    // ⑨ 今回触られなかった行にだけ missing_since を付ける。基準時刻は DB 由来（論点F）。
    //    追跡可能な行が 1 件も無い CSV では基準時刻を作れないため、判定自体を行わない。
    const misStart = performance.now()
    if (dbNow) {
      missingMarked = await markMissingRows(supabase, listId, dbNow)
    }
    timings.missing = elapsedMsSince(misStart)

    // 名簿本体を今回の取込に合わせて更新する（RLS: cl_update_org。取込は作成者本人のみ
    //   実行できる〔上の④で 403 済み〕ため user_id=auth.uid() を満たし UPDATE が通る）。
    //   - row_count : 今回の CSV の件数（既存処理を踏襲・二重に書かない）。
    //   - updated_at: DB 由来の値で揃える（既存挙動のまま）。
    //   - imported_at: 実取込の時刻。空リスト作成時点で DEFAULT now() が入っているため、
    //       実際に取り込めたこのタイミングで更新する（PR-E 決定5）。tracked が無く dbNow が
    //       取れない CSV では実行時刻で補う（DB 時刻との差はミリ秒オーダーで実害なし）。
    //   - column_mapping: v:2 の nested 形で保存（決定1）。既存 flat 形（レガシー /import）
    //       とは "v" の有無で判別できる。⛔ レガシー側の flat 保存は変更しない。
    const patch: {
      row_count: number
      updated_at?: string
      imported_at: string
      column_mapping: Record<string, unknown>
    } = {
      row_count: plan.tracked.length + plan.untracked.length,
      imported_at: dbNow ?? new Date().toISOString(),
      column_mapping: buildColumnMappingV2(rows[0], mapping, resolveRoute, presetId),
    }
    if (dbNow) patch.updated_at = dbNow
    await supabase.from('customer_lists').update(patch).eq('id', listId)
  } catch (error) {
    const stage: ImportStage = timings.upsert == null ? 'upsert' : 'missing'
    if (stage === 'upsert') timings.upsert = elapsedMsSince(uStart)
    reportImportError(error, { requestId, stage, timings })
    return failEnvelope(
      500,
      stage,
      stage === 'upsert' ? 'upsert_failed' : 'mark_missing_failed',
      requestId,
      timings,
      startedAt,
    )
  }

  // 日付を NULL にした根拠の集計（原則1: 件数だけでも運用で気づけるようにする）。
  const dateNullRows = extracted.filter((e) => e.reasons.length > 0).length

  return NextResponse.json(
    {
      ok: true,
      id: listId,
      encoding,
      // 解決経路（fallback:heuristic は O49 の誤検出リスクが残るため後続 UI で警告表示に使う）。
      resolve_route: resolveRoute,
      row_count: plan.tracked.length + plan.untracked.length,
      tracked: plan.tracked.length,
      untracked: plan.untracked.length,
      // ⛔ 顧客番号そのものは返さない（件数のみ）。
      deduped: plan.dedupedExternalIds.length,
      date_null_rows: dateNullRows,
      missing_marked: missingMarked,
      summary,
      as_of_by_municipality: muniAsOf,
      requestId,
      timings,
    },
    { headers: requestIdHeader(requestId) },
  )
}

// column_mapping を v:2 の nested 形で組み立てる（決定1）。
//   { v: 2, columns: {論理列→実ヘッダ名}, resolve_route, preset_id? }
//   - "v" は数値リテラル 2（読取り側が `m.v === 2 ? m.columns : m` で flat と分岐できる）。
//   - "columns" は単一 index マッピング（heuristic / preset 双方が持つ。preset の複合住所は
//       結合末尾列が address に入る）を header 名へ解決したもの。
//   - "preset_id" は ?preset= があるときだけ入れる。無ければキーごと省略（null を入れない）。
//   ⛔ resolve_route の型は presets.ts の ResolveRoute をそのまま使う（新設しない）。
function buildColumnMappingV2(
  header: string[],
  mapping: ColumnMapping,
  route: ResolveRoute,
  presetId: string | null,
): Record<string, unknown> {
  const columns: Record<string, string> = {}
  for (const key of Object.keys(mapping) as (keyof ColumnMapping)[]) {
    const idx = mapping[key]
    if (idx != null) columns[key] = header[idx] ?? ''
  }
  const out: Record<string, unknown> = { v: 2, columns, resolve_route: route }
  if (presetId != null && presetId !== '') out.preset_id = presetId
  return out
}

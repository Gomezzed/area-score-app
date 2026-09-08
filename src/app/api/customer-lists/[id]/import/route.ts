import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { guardFeature } from '@/lib/subscription'
import { decodeCsvBytes, CsvDecodeError } from '@/lib/customer-list/decode'
import { parseCsv } from '@/lib/customer-list/csv-import'
import {
  resolveColumnMapping,
  buildColumnMappingV3,
  UnknownPresetError,
} from '@/lib/customer-list/presets'
import { extractRows, countDateNullRows } from '@/lib/customer-list/row-extract'
import { summarizeImportConditions } from '@/lib/customer-list/import-summary'
import { planUpsert } from '@/lib/customer-list/upsert-plan'
import {
  matchAddress,
  buildTownIndex,
  resolveMunicipalityIds,
} from '@/lib/customer-list/match'
import { normalizeJpAddress } from '@/lib/address/normalize-jp'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  isCustomerListEnabled,
  loadMunicipalities,
  loadTownData,
  loadExistingExternalIds,
  loadPropertyTypeLabels,
  upsertCustomerListRows,
  replaceUntrackedRows,
  replaceRowPropertyTypes,
  markMissingRows,
  markDeletedRows,
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
import type { MatchResult } from '@/lib/customer-list/types'
import type { PropertyTypeCode } from '@/lib/customer-list/presets'

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
  | 'propertyTypes'
  | 'missing'
  | 'match'
  | 'desiredDistricts'
  | 'finalize'

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
//     ⑧-b 希望物件種別×価格帯の子行を list 単位で洗い替え（BM-2・admin/service_role）
//     ⑨ 今回触られなかった行に missing_since を付与（PR-A 申し送り③）
//     ⑩ 住所→代表点→校区の突合バッチ（match_customer_list_rows・admin・fail-soft）
//     ⑪ 希望校区の名寄せ（match_customer_list_desired_districts・admin・fail-soft・BM-2）
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
  // BM-2: label_ja → property_types.code の解決表を 1 回だけ読む（原則19）。
  //   プリセットが物件種別の列を解決したときだけ引く（heuristic 経路では引かない）。
  //   ⚠ fail-soft: 参照マスタが読めなくても取込自体は続ける。解決表が無い行には
  //      row-extract が reason 'property_type:resolver_unavailable' を残し、子行は作らない
  //      （推測で種別を作らない）。
  let propertyTypeByLabel: Map<string, PropertyTypeCode> | undefined
  if (extract.propertyTypeColumn != null || extract.sellPropertyTypeColumn != null) {
    try {
      propertyTypeByLabel = await loadPropertyTypeLabels(supabase)
    } catch (error) {
      reportImportError(error, { requestId, stage: 'parse', timings })
    }
  }
  const extracted = extractRows(dataRows, mapping, { ...extract, propertyTypeByLabel })
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
  let deletedMarked = 0
  // BM-2: 子行の書き込み結果（件数のみ・個票は持たない）。
  let propertyTypeRowsWritten = 0
  let propertyTypeError = false
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
      // 面積 4 列も同じ流儀。プリセットが面積列を解決したときだけ SET 句に載せる。
      persistDesiredArea:
        extract.floorAreaColumns != null || extract.landAreaColumns != null,
    })

    // ⑦ 追跡可能な行（external_id 有り）を毎回全件 UPSERT。
    const dbNow = await upsertCustomerListRows(supabase, plan.tracked)

    // ⑧ 追跡不能な行（external_id 無し）は当該 list の NULL 行だけを全置換（論点B ③）。
    await replaceUntrackedRows(supabase, listId, plan.untracked)
    timings.upsert = elapsedMsSince(uStart)

    // ⑧-b BM-2: 希望物件種別×価格帯の子行を list 単位で洗い替える（delete → insert）。
    //    ⚠ admin（service_role）で書く: 子テーブルは authenticated=SELECT のみで、書込は
    //       service_role が行う導出データ（BM-1 20260908000100:196-197）。GRANT も RLS も
    //       変更しない。認可は上の ④（作成者本人 403）で担保済み。
    //    ⚠ 親 UPSERT の直後・missing 判定より前に実行する（子行は親行の FK を参照するため）。
    //    ⚠ fail-soft: 行本体は既にコミット済み。ここで 500 にすると「行は入ったのに失敗」の
    //       誤報になるため、失敗は Sentry に送りサマリに error を立てて続行する。
    const ptStart = performance.now()
    try {
      const ptAdmin = getSupabaseAdmin()
      if (!ptAdmin) {
        // service_role 未設定（環境差）。子行の書き込みはスキップし可観測にする。
        throw new Error('supabase admin client unavailable')
      }
      await replaceRowPropertyTypes(ptAdmin, listId, plan.propertyTypeRows)
      propertyTypeRowsWritten = plan.propertyTypeRows.length
    } catch (error) {
      propertyTypeError = true
      reportImportError(error, { requestId, stage: 'propertyTypes', timings })
    }
    timings.propertyTypes = elapsedMsSince(ptStart)

    // ⑧-c 裁定A(a): 削除フラグ ON かつ DB 既存の行に deleted_at を立てる（内容は更新しない）。
    //    ⚠ missing 判定より前に実行する。deleted_at の UPDATE はトリガーで updated_at を
    //       進めるため、この後の markMissingRows（updated_at < t 条件）が削除行を対象外にでき、
    //       削除行へ missing_since が二重に付くのを防げる。基準時刻は DB 由来 dbNow を使い、
    //       tracked が無く dbNow が取れない CSV では実行時刻で補う（missing と同じ流儀）。
    const deletedAt = dbNow ?? new Date().toISOString()
    if (plan.deletedRowIds.length > 0) {
      deletedMarked = await markDeletedRows(supabase, listId, plan.deletedRowIds, deletedAt)
    }

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
      // BM-2: v:3（v:2 のキーは名前も意味も変えず、解決した列 index を追記する）。
      column_mapping: buildColumnMappingV3(rows[0], mapping, extract, resolveRoute, presetId),
    }
    if (dbNow) patch.updated_at = dbNow
    // 監査上重要な列（column_mapping/imported_at）を載せる UPDATE のため、失敗を握りつぶさない。
    //   ⚠ 行本体（⑦〜⑨）は既にコミット済みで取込自体は成功しているため、ここで 500 にすると
    //      「行は入ったのに失敗」の誤報になる。よって HTTP は成功のまま返し、失敗は Sentry に
    //      必ず送って可観測にする（200 なのにメタデータだけ静かに未保存、を作らない・確認A(3)）。
    const { error: patchErr } = await supabase
      .from('customer_lists')
      .update(patch)
      .eq('id', listId)
    if (patchErr) {
      reportImportError(patchErr, { requestId, stage: 'finalize', timings })
    }
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

  // ⑩ 突合結線（PR-D改 c2）: 取り込んだ全行を住所→代表点→校区に突合し、
  //    customer_list_row_geocodes / customer_list_row_school_districts へ書く。
  //    ⚠ 既存 2 関数は SECURITY INVOKER かつ参照表 deny-by-default のため、突合は
  //      service_role 実行の DEFINER バッチ RPC match_customer_list_rows で回す（裁定B）。
  //    ⚠ 住所の (muni_code_5, town, chome, ban, go) 分解は SQL 側に無いので TS で行い渡す。
  //    ⚠ fail-soft: 突合は取込成功後の派生処理。行本体は既にコミット済みのため、ここで
  //      失敗しても HTTP は成功のまま返し、失敗は Sentry に送って可観測にする（誤報を作らない）。
  //      削除済み行の除外は RPC 側（deleted_at IS NULL）で担保する。
  let matchSummary: unknown = null
  const matchStart = performance.now()
  try {
    const admin = getSupabaseAdmin()
    if (!admin) {
      // service_role 未設定（環境差）。突合はスキップし可観測にする（取込は成功）。
      reportImportError(new Error('supabase admin client unavailable'), {
        requestId,
        stage: 'match',
        timings,
      })
    } else {
      const pRows = [...plan.tracked, ...plan.untracked].map((r) => {
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
      const { data, error: matchErr } = await admin.rpc('match_customer_list_rows', {
        p_list_id: listId,
        p_rows: pRows,
      })
      if (matchErr) {
        reportImportError(matchErr, { requestId, stage: 'match', timings })
      } else {
        matchSummary = data
      }
    }
  } catch (error) {
    reportImportError(error, { requestId, stage: 'match', timings })
  }
  timings.match = elapsedMsSince(matchStart)

  // ⑪ BM-2: 希望校区の名寄せ（match_customer_list_desired_districts）。
  //    ⚠ admin（service_role）で呼ぶ: この RPC は SECURITY DEFINER で EXECUTE が
  //       service_role のみに付いている（BM-1 20260908000200）。
  //    ⚠ fail-soft: 名寄せは取込成功後の派生処理。失敗しても取込全体を失敗にせず、
  //       サマリに { error: true } を入れて続行する（誤報を作らない・住所突合と同じ流儀）。
  let desiredDistricts: unknown = { error: true }
  const ddStart = performance.now()
  try {
    const ddAdmin = getSupabaseAdmin()
    if (!ddAdmin) {
      reportImportError(new Error('supabase admin client unavailable'), {
        requestId,
        stage: 'desiredDistricts',
        timings,
      })
    } else {
      const { data, error: ddErr } = await ddAdmin.rpc(
        'match_customer_list_desired_districts',
        { p_list_id: listId },
      )
      if (ddErr) {
        reportImportError(ddErr, { requestId, stage: 'desiredDistricts', timings })
      } else {
        // RPC の jsonb サマリをそのままマージする（件数のみ・個票は返らない）。
        desiredDistricts = data
      }
    }
  } catch (error) {
    reportImportError(error, { requestId, stage: 'desiredDistricts', timings })
  }
  timings.desiredDistricts = elapsedMsSince(ddStart)

  // 日付を NULL にした根拠の集計（原則1: 件数だけでも運用で気づけるようにする）。
  //   ⚠ reasons は BM-2 で日付以外（価格・面積・物件種別）の根拠も持つようになったため、
  //      日付の接頭辞を持つ行だけを数える（既存メトリクスの意味を保つ・裁定8）。
  const dateNullRows = countDateNullRows(extracted)

  // BM-2 の集計（⛔ 件数のみ。生値・個票は返さない・D144/D122）。
  //   集計そのものは純ロジック（import-summary.ts）に置き、ここでは組み立てない。
  const conditionSummary = summarizeImportConditions(extracted, propertyTypeRowsWritten)

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
      deleted_marked: deletedMarked,
      summary,
      // 突合バッチの集計（RPC の jsonb サマリ。未実行/失敗時は null）。
      match: matchSummary,
      // ── BM-2 の集計（件数のみ・⛔ 未解決トークンそのものは返さない）──
      ...conditionSummary,
      // 子行の書き込みに失敗した場合だけ error を添える（property_type_rows は 0 のまま）。
      ...(propertyTypeError ? { property_type_error: true } : {}),
      // 希望校区の名寄せ RPC の jsonb サマリ（失敗時は { error: true }）。
      desired_districts: desiredDistricts,
      as_of_by_municipality: muniAsOf,
      requestId,
      timings,
    },
    { headers: requestIdHeader(requestId) },
  )
}

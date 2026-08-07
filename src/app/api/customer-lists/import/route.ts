import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { guardFeature } from '@/lib/subscription'
import {
  parseCsv,
  detectColumnMapping,
  cellOf,
  parseDateLoose,
} from '@/lib/customer-list/csv-import'
import { matchAddress } from '@/lib/customer-list/match'
import { isCustomerListEnabled, loadTownIndex } from '@/lib/customer-list/server'
import type { CustomerColumnKey } from '@/lib/customer-list/types'

export const runtime = 'nodejs'

// 取り込み上限（原則: 一気にやらない・サービス保護）。
const MAX_ROWS = 5000
// 行 INSERT のバッチ分割サイズ。
const INSERT_CHUNK = 500

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
  // ① サーバー側フィーチャーフラグ（UI と二層）。off なら存在ごと 404。
  if (!isCustomerListEnabled()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // ② platinum 認可（未認証 401 / 非platinum 403）。町域取得優先＝platinum専用。
  const denied = await guardFeature('townAcquisitionPriority')
  if (denied) return denied

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // guardFeature 通過済だが型の絞り込みのため再確認。
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // ③ Body 検証 → CSV パース
  let body: { csv?: unknown; name?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const csvText = typeof body.csv === 'string' ? body.csv : ''
  if (!csvText.trim()) {
    return NextResponse.json({ error: 'empty_csv' }, { status: 400 })
  }
  const listName =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 200)
      : '顧客名簿'

  const rows = parseCsv(csvText)
  if (rows.length < 2) {
    return NextResponse.json({ error: 'no_data_rows' }, { status: 400 })
  }
  const header = rows[0]
  const dataRows = rows.slice(1)
  if (dataRows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: 'too_many_rows', max: MAX_ROWS, got: dataRows.length },
      { status: 400 },
    )
  }

  const mapping = detectColumnMapping(header)
  if (mapping.address == null) {
    return NextResponse.json(
      { error: 'address_column_not_found', header },
      { status: 400 },
    )
  }

  // ④ 突合インデックス構築（platinum のみ SELECT 可。0件なら全 out_of_scope）
  const index = await loadTownIndex(supabase)

  // 各行を突合。電話番号は取り込むが保存しない（列に含めない・個人情報最小化）。
  let confirmed = 0
  let ambiguous = 0
  let outOfScope = 0

  const rowInserts = dataRows.map((row, i) => {
    const addressRaw = cellOf(row, mapping, 'address')
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

  // ⑤ 名簿本体を作成（RLS: cl_insert_own）。
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
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 })
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
      return NextResponse.json({ error: 'insert_rows_failed' }, { status: 500 })
    }
  }

  // ⑥ サマリを返す
  return NextResponse.json({
    id: listId,
    name: listName,
    row_count: dataRows.length,
    summary: { confirmed, ambiguous, out_of_scope: outOfScope },
  })
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

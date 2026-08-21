// ============================================================
// CSV データ行 → 保存候補の中間表現（ExtractedRow）への抽出。
//   依存ゼロ（React/DB 非依存）。パーサと DB 層の境界に置く。
//
// ⛔ CL-32（CL-26 の解釈確定）: 氏名のみ保持。フリガナ・電話・メール・生年月日・
//    同居人氏名・勤務先・年収などの個人識別/機微情報は「読み捨て」る。
//    → 構造的な担保:
//       ① 読み出しは EXTRACT_KEYS の許可リスト経由のみ（cellOf を他キーで呼ばない）
//       ② ExtractedRow の型にそれらのキーを一切持たせない
//      ＝ パースした値が保存先の変数へ到達する経路そのものが存在しない。
// ============================================================

import { cellOf, parseDateWithReason } from './csv-import.ts'
import type { ColumnMapping, CustomerColumnKey } from './types.ts'

// 値を読み出してよい論理列の許可リスト（CL-32）。
//   ⛔ ここに 'phone' を足さないこと。detectColumnMapping は phone を検出するが、
//      検出（列がどこにあるか）と読み出し（値を変数に入れる）は別で、後者を行わない。
export const EXTRACT_KEYS = [
  'external_id',
  'customer_name',
  'address',
  'media',
  'category',
  'assignee',
  'inquiry_at',
  'last_contact_at',
] as const satisfies readonly CustomerColumnKey[]

// 読み捨てる論理列（値を一切変数に入れない）。テストで参照する。
export const DISCARDED_KEYS: readonly CustomerColumnKey[] = ['phone']

// CSV 1 行から取り出した保存候補。PII 列（電話・フリガナ・メール等）はキーごと存在しない。
export interface ExtractedRow {
  row_no: number
  // ⚠ CL-09/O44: 顧客番号は必ず文字列。Number()/parseInt()/単項 + を通さない
  //    （ゼロ落ち・指数表記化を構造的に防ぐ）。空文字は null。
  external_id: string | null
  customer_name: string | null
  address_raw: string | null
  inquiry_at: string | null
  last_contact_at: string | null
  media: string | null
  category: string | null
  assignee: string | null
  // PR-C（ハウスドゥ列マッピング）で充填する。PR-B では常に null のため、
  // UPSERT ペイロードには含めない（含めると PR-C の値を毎回消してしまう）。
  desired_school: string | null
  desired_muni_code_5: string | null
  // オプトアウト3列（O55）と削除フラグ（O54）。値は「空=OFF/非空=ON」で解釈する。
  //   プリセットが該当列を解決したときのみ true になりうる。列が無ければ常に false
  //   （heuristic 経路・該当列を持たない CSV では全行 OFF＝列位置決め打ちをしない）。
  opt_out_dm: boolean
  opt_out_mail_magazine: boolean
  opt_out_mail: boolean
  is_deleted: boolean
  // 値を NULL にした根拠（原則1: 推定・欠損の理由を必ず残す）。
  reasons: string[]
}

// 空文字を null に潰す（未入力と空を同一視）。
function emptyToNull(s: string): string | null {
  const t = s.trim()
  return t ? t : null
}

// プリセット経路でのみ渡す抽出補助（presets.ts の ResolvedMapping.extract）。
//   ⚠ ここで参照する列（住所を構成する都道府県/市区/住所・小学校区）は
//      いずれも PII ではない構造的な列で、プリセットが完全一致で確定させたもの。
//      EXTRACT_KEYS の許可リスト（CL-32）は PII の読み出し防止が目的であり、
//      これらの非 PII 列を index 指定で読むことは方針に反しない。
export interface ExtractOptions {
  // 複合住所（都道府県+市区+住所）。指定時は mapping.address より優先して結合する。
  addressColumns?: number[]
  // desired_school（マッチング小学校）の列。指定時のみ値を保持する。
  schoolColumn?: number
  // オプトアウト/削除フラグの列（プリセット経路でのみ渡す・O54/O55）。
  //   ⛔ 未指定なら該当フラグは全行 false（列位置決め打ちをしない）。
  optOutDmColumn?: number
  optOutMailMagazineColumn?: number
  optOutMailColumn?: number
  deletedColumn?: number
}

// フラグ列の値を ON/OFF に解釈する（空=OFF / 非空=ON）。列未指定なら常に false。
//   ⛔ 列位置の決め打ちはしない: 呼び出し側（プリセット）が解決した index のみを見る。
function flagOn(row: string[], idx: number | undefined): boolean {
  if (idx == null) return false
  return cellAt(row, idx) !== ''
}

// index 指定でセル値を読む（範囲外は空文字）。
function cellAt(row: string[], idx: number | undefined): string {
  if (idx == null) return ''
  return (row[idx] ?? '').trim()
}

// データ行（ヘッダ除く）を ExtractedRow[] へ変換する。
//   - row_no は 1 始まり（CSV 上のデータ行番号）。
//   - 日付は parseDateWithReason で複数書式を試し、不一致なら null + reason。
//   - opts はプリセット経路でのみ渡す（未指定なら従来どおりの単一列抽出）。
export function extractRows(
  dataRows: string[][],
  mapping: ColumnMapping,
  opts: ExtractOptions = {},
): ExtractedRow[] {
  return dataRows.map((row, i) => {
    const reasons: string[] = []

    const inquiry = parseDateWithReason(cellOf(row, mapping, 'inquiry_at'))
    if (inquiry.reason) reasons.push(`inquiry_at:${inquiry.reason}`)
    const lastContact = parseDateWithReason(cellOf(row, mapping, 'last_contact_at'))
    if (lastContact.reason) reasons.push(`last_contact_at:${lastContact.reason}`)

    // ⚠ external_id は cellOf（string 返却）→ trim のみ。数値変換を一切挟まない。
    const externalId = emptyToNull(cellOf(row, mapping, 'external_id'))

    // 住所: プリセットの複合列（都道府県+市区+住所）があればそれを順に結合する。
    //   正規化（normalizeJpAddress）は突合エンジン側で行うため、ここでは生結合のみ。
    const addressRaw =
      opts.addressColumns && opts.addressColumns.length
        ? emptyToNull(opts.addressColumns.map((c) => cellAt(row, c)).join(''))
        : emptyToNull(cellOf(row, mapping, 'address'))

    // desired_school: プリセットの小学校区列（マッチング小学校）があれば保持する。
    //   ⛔ 中学校区は school_type 列が無いため本 PR では保持しない（PR-D で対応）。
    const desiredSchool =
      opts.schoolColumn != null ? emptyToNull(cellAt(row, opts.schoolColumn)) : null

    return {
      row_no: i + 1,
      external_id: externalId,
      customer_name: emptyToNull(cellOf(row, mapping, 'customer_name')),
      address_raw: addressRaw,
      inquiry_at: inquiry.value,
      last_contact_at: lastContact.value,
      media: emptyToNull(cellOf(row, mapping, 'media')),
      category: emptyToNull(cellOf(row, mapping, 'category')),
      assignee: emptyToNull(cellOf(row, mapping, 'assignee')),
      desired_school: desiredSchool,
      // desired_muni_code_5: 「マッチング市区」は市区名でありコードではない。
      //   名前→5桁コード変換（prefecture_code+name 複合キー）は PR-D で行う（原則2）。
      desired_muni_code_5: null,
      // オプトアウト/削除フラグ（空=OFF/非空=ON）。列未指定は false。
      opt_out_dm: flagOn(row, opts.optOutDmColumn),
      opt_out_mail_magazine: flagOn(row, opts.optOutMailMagazineColumn),
      opt_out_mail: flagOn(row, opts.optOutMailColumn),
      is_deleted: flagOn(row, opts.deletedColumn),
      reasons,
    }
  })
}

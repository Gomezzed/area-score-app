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
import { toLeadType, type LeadType } from './lead-type.ts'
import { parsePriceManyen, parseAreaSqm } from './parse-number.ts'
import { PRICE_TARGETS, type PropertyTypeCode, type PriceColumns, type AreaColumns } from './presets.ts'
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
  // 反響区分（BM-2）。辞書は lead-type.ts の 1 箇所（完全一致・推測しない）。
  //   category（『顧客種別』）が空・未知でも 'unknown' を必ず入れる（DB は NOT NULL）。
  lead_type: LeadType
  // 希望物件種別×価格帯（BM-2）。customer_list_row_property_types の子行になる。
  //   ⛔ 解決できなかった値から子行を作らない（推測で種別を作らない・原則1/5）。
  property_types: ExtractedPropertyType[]
  // 希望面積（BM-2・㎡・整数）。列が未解決なら常に null（列位置を決め打ちしない）。
  desired_floor_area_min: number | null
  desired_floor_area_max: number | null
  desired_land_area_min: number | null
  desired_land_area_max: number | null
  // 値を NULL にした根拠（原則1: 推定・欠損の理由を必ず残す）。
  //   ⛔ 生値を含みうるため API レスポンスには載せない（件数のみ返す・D144）。
  reasons: string[]
}

// 子行 1 件ぶんの抽出結果（customer_list_row_property_types の列に対応）。
//   row_id / list_id / user_id / organization_id は DB 書き込み時に付与する。
export interface ExtractedPropertyType {
  code: PropertyTypeCode
  // 価格帯（万円・整数）。未入力・解釈不能はいずれも null（理由は reasons 側に残る）。
  price_min: number | null
  price_max: number | null
  // 第一根拠（『マッチング物件種別』で明示された種別）なら true。
  //   価格列だけから作った子行は false（明示されていないため）。
  is_primary: boolean
}

// 「日付を NULL にした根拠」とみなす reason の接頭辞（唯一の定義・裁定8）。
//   ⚠ reasons は日付以外（価格・面積・物件種別）の根拠も持つようになったため、
//      取込サマリの date_null_rows は接頭辞で絞って数える。ここに列挙されていない
//      reason は date_null_rows に加算されない（既存メトリクスの意味を保つ）。
//   ⛔ 新しい日付列を足したときはこの配列に追加する（判定を各所に散らさない）。
export const DATE_NULL_REASON_PREFIXES = ['inquiry_at:', 'last_contact_at:'] as const

// 日付の根拠を 1 つでも持つ行の件数（取込サマリの date_null_rows）。
export function countDateNullRows(rows: readonly ExtractedRow[]): number {
  return rows.filter((r) =>
    r.reasons.some((reason) => DATE_NULL_REASON_PREFIXES.some((p) => reason.startsWith(p))),
  ).length
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
  // 購入希望マッチ（BM-2）。presets.ts の ResolvedMapping.extract をそのまま受け取る。
  propertyTypeColumn?: number // 列96『マッチング物件種別』（買い行の第一根拠）
  sellPropertyTypeColumn?: number // 列150『物件種別』（売り行）
  priceColumns?: PriceColumns // 列97〜108（code ごとの下限/上限・第二根拠）
  floorAreaColumns?: AreaColumns // 列111/112『マッチング専有面積下限/上限』
  landAreaColumns?: AreaColumns // 列109/110『マッチング土地面積下限/上限』
  // label_ja → property_types.code の解決表（DB の property_types を 1 回 SELECT して作る）。
  //   ⛔ TS 側にハードコードしない（原則19）。テストはスタブの Map を渡す。
  //      未指定なら種別を解決できない＝子行を作らない（推測しない）。
  propertyTypeByLabel?: ReadonlyMap<string, PropertyTypeCode>
}

// 物件種別トークンの区切り（NFKC 後に評価するため '／' は '/' に、'，' は ',' になっている）。
const TYPE_TOKEN_SEPARATOR = /[,、/\s]+/

// 比較キーへの正規化（NFKC → trim）。label_ja の解決表・トークンの双方に同じものを掛ける。
function normalizeLabel(s: string): string {
  return s.normalize('NFKC').trim()
}

// 価格セルを読んで子行の価格帯を作る。
//   「下限・上限の少なくとも一方が非空」なら子行の対象とする（値が解釈不能でも対象にする。
//    非空＝顧客が何か書いた事実は残っているため、子行を作らず黙って捨てない）。
function readPriceRange(
  row: string[],
  cols: AreaColumns | undefined,
  reasonPrefix: string,
  reasons: string[],
): { present: boolean; min: number | null; max: number | null } {
  if (!cols) return { present: false, min: null, max: null }
  const rawMin = cellAt(row, cols.min)
  const rawMax = cellAt(row, cols.max)
  const parsedMin = parsePriceManyen(rawMin)
  const parsedMax = parsePriceManyen(rawMax)
  if (parsedMin.unparsed) reasons.push(`${reasonPrefix}_min:unparsed`)
  if (parsedMax.unparsed) reasons.push(`${reasonPrefix}_max:unparsed`)
  return { present: rawMin !== '' || rawMax !== '', min: parsedMin.value, max: parsedMax.value }
}

// 面積セルを読む（㎡・整数）。列未解決・未入力は null。解釈不能は null + reason。
function readArea(
  row: string[],
  idx: number | undefined,
  field: string,
  reasons: string[],
): number | null {
  if (idx == null) return null
  const parsed = parseAreaSqm(cellAt(row, idx))
  if (parsed.unparsed) reasons.push(`${field}:unparsed`)
  return parsed.value
}

// 1 行ぶんの希望物件種別×価格帯を組み立てる（BM-2）。
//   買い行: 第一根拠＝『マッチング物件種別』（複数可・is_primary=true）
//           第二根拠＝価格 6 組（下限/上限の一方でも非空なら子行を作る・is_primary=false）
//           第一根拠に既にある code は価格だけを補完する。
//   売り行: 『物件種別』が label_ja と完全一致したときだけ子行 1 本（価格 NULL）。
//   unknown 行: 子行を作らない（どちらの根拠も適用しない＝推測しない）。
//   ⛔ 未知トークン・未解決は reasons に残し、子行は作らない（原則1/5）。
function extractPropertyTypes(
  row: string[],
  opts: ExtractOptions,
  leadType: LeadType,
  reasons: string[],
): ExtractedPropertyType[] {
  const dict = opts.propertyTypeByLabel
  const out: ExtractedPropertyType[] = []
  const byCode = new Map<PropertyTypeCode, ExtractedPropertyType>()

  if (leadType === 'sell') {
    const raw = cellAt(row, opts.sellPropertyTypeColumn)
    if (raw === '') return out
    const code = dict?.get(normalizeLabel(raw))
    if (code == null) {
      // 解決できない値から種別を作らない（'一戸建て' 等の表記揺れも推測しない）。
      reasons.push(`sell_property_type:unresolved:${raw}`)
      return out
    }
    out.push({ code, price_min: null, price_max: null, is_primary: true })
    return out
  }

  if (leadType !== 'buy') return out

  // 第一根拠: 『マッチング物件種別』を区切り文字で分割し、label_ja と完全一致で解決する。
  const rawTypes = cellAt(row, opts.propertyTypeColumn)
  if (rawTypes !== '') {
    if (dict == null) {
      // 解決表が無い（DB 読み出し失敗など）。黙って種別無しにせず理由を残す。
      reasons.push('property_type:resolver_unavailable')
    } else {
      for (const token of normalizeLabel(rawTypes).split(TYPE_TOKEN_SEPARATOR)) {
        if (token === '') continue
        const code = dict.get(token)
        if (code == null) {
          reasons.push(`property_type:unknown_token:${token}`)
          continue
        }
        if (byCode.has(code)) continue // 同じ種別が 2 回書かれていても子行は 1 本
        const entry: ExtractedPropertyType = {
          code,
          price_min: null,
          price_max: null,
          is_primary: true,
        }
        byCode.set(code, entry)
        out.push(entry)
      }
    }
  }

  // 第二根拠: 価格 6 組。第一根拠にある code は価格だけを補完し、無い code は
  //   is_primary=false の子行を新設する（第一根拠を優先する＝明示された種別だけが primary）。
  for (const { code } of PRICE_TARGETS) {
    const range = readPriceRange(row, opts.priceColumns?.[code], `price_${code}`, reasons)
    if (!range.present) continue
    const existing = byCode.get(code)
    if (existing) {
      existing.price_min = range.min
      existing.price_max = range.max
      continue
    }
    // 明示された種別と価格の指定が食い違う行（価格だけある種別）。事実として残す。
    if (byCode.size > 0) reasons.push(`property_type:price_without_type:${code}`)
    const entry: ExtractedPropertyType = {
      code,
      price_min: range.min,
      price_max: range.max,
      is_primary: false,
    }
    byCode.set(code, entry)
    out.push(entry)
  }

  return out
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

    // 反響区分（BM-2）。category の生値を辞書で 3 値に落とす（未知・空は unknown）。
    const leadType = toLeadType(cellOf(row, mapping, 'category'))
    // 希望物件種別×価格帯（BM-2）。lead_type で根拠の取り方が変わる。
    const propertyTypes = extractPropertyTypes(row, opts, leadType, reasons)

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
      lead_type: leadType,
      property_types: propertyTypes,
      // 希望面積（㎡・整数）。列が未解決なら null（列位置を決め打ちしない）。
      //   ⚠ 売り行でも列自体は読む（『マッチング〜』は行に紐づく事実であり、
      //      lead_type で読み分ける根拠が無いため）。未入力なら null になる。
      desired_floor_area_min: readArea(
        row,
        opts.floorAreaColumns?.min,
        'desired_floor_area_min',
        reasons,
      ),
      desired_floor_area_max: readArea(
        row,
        opts.floorAreaColumns?.max,
        'desired_floor_area_max',
        reasons,
      ),
      desired_land_area_min: readArea(
        row,
        opts.landAreaColumns?.min,
        'desired_land_area_min',
        reasons,
      ),
      desired_land_area_max: readArea(
        row,
        opts.landAreaColumns?.max,
        'desired_land_area_max',
        reasons,
      ),
      reasons,
    }
  })
}

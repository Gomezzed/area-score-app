// ============================================================
// CSV 取込プリセット（ハウスドゥ形式・CL-03）。React/DB 非依存の純ロジック。
//
// ⚠ O49: v0 の detectColumnMapping はキーワード部分一致で 174 列に対して誤検出する
//    （例: 「担当」→「店舗営業担当者ID」）。さらにフィクスチャには同名列が実在する
//    （`反響媒体` が 2 回・`携帯番号（補助）1〜3`・`補助媒体1〜10` 等）。
//    → 本プリセットは **キーワード推測をやめ、ヘッダ名の完全一致（NFKC 正規化後）＋
//       同名列に備えた出現位置（nth）指定** で解決する。exact 比較なので
//       「店舗営業担当者」と「店舗営業担当者ID」は別文字列として衝突しない。
//
// 永続化の範囲（PM 実測 2026-08-19・customer_list_rows 23 列）:
//   - このPRで永続化する: external_id / customer_name / address(複合結合) / category /
//       inquiry_at / last_contact_at / media / assignee / desired_school
//   - 解決＋テストのみ・永続化は PR-D（対応 DB 列が無い or 値がコードでない）:
//       desired_muni_code_5 / rank / status / desired_junior_school
//   - BM-2 で永続化する: lead_type（category から辞書変換）/ 希望面積 4 列 /
//       物件種別・価格帯（customer_list_row_property_types の子行）。
//       price_* は BM-2 で「解決のみ」から「永続化する」へ変わった。
// ============================================================

import { detectColumnMapping } from './csv-import.ts'
import type { ColumnMapping, CustomerColumnKey } from './types.ts'

// 解決経路（PO 指示: 後続 PR で UI 警告を出せるよう戻り値に含める）。
//   'fallback:heuristic' は O49 の誤検出リスクが残る経路であることを可視化する。
export type ResolveRoute =
  | 'preset:hausudo'
  | 'fingerprint:hausudo'
  | 'fallback:heuristic'

// プリセットが解決する論理ターゲット（CustomerColumnKey の上位集合）。
//   永続化しないターゲットも「列がどこにあるか」をテストで固定するために列挙する。
export type PresetTarget =
  // --- このPRで永続化する ---
  | 'external_id'
  | 'customer_name'
  | 'address'
  | 'category'
  | 'inquiry_at'
  | 'last_contact_at'
  | 'media'
  | 'assignee'
  | 'desired_school'
  // --- オプトアウト/削除フラグ（O54/O55・PR-D改 c3）。値は空=OFF/非空=ON で解釈する ---
  //   opt_out_* は customer_list_rows の boolean 列へ保存し、attack-list 表示で除外する。
  //   deleted は customer_list_rows.deleted_at の設定/解除に使う（行本体は作らない/更新しない）。
  | 'opt_out_dm' // 72列: DM郵送希望
  | 'opt_out_mail_magazine' // 89列: メルマガフラグ（メール営業対象者フラグ）
  | 'opt_out_mail' // 90列: メール禁止フラグ
  | 'deleted' // 123列: 削除フラグ
  // --- 購入希望マッチ（BM-2）。列番号は 1 始まり（実装は index -1 で読む）---
  //   property_type      : 列96『マッチング物件種別』。買い行の第一根拠。
  //                        値は label_ja 表記（例 '新築戸建'）で code ではない。
  //                        label_ja→code の解決表は property_types を SELECT して作る
  //                        （⛔ TS にハードコードしない・原則19）。
  //   sell_property_type : 列150『物件種別』。売り行の物件種別（単一値）。
  //                        ★ 列150 が「売却対象物件の種別」である点は fixture v1 の
  //                          ヘッダ名からの解釈で、実データでの確認は未了。
  //   desired_*_area_*   : 列109〜112。BM-2 c0 の customer_list_rows 4 列へ永続化する。
  | 'property_type'
  | 'sell_property_type'
  | 'desired_land_area_min'
  | 'desired_land_area_max'
  | 'desired_floor_area_min'
  | 'desired_floor_area_max'
  // --- 解決＋テストのみ・永続化は PR-D ---
  //   desired_muni_code_5: 「マッチング市区」は 5 桁コードではなく **市区名**（実測: 岡崎市）。
  //     名前をコード列に入れない（原則2）。PR-D で prefecture_code + name の複合キーで
  //     municipalities を引いて city_code に変換する。そのため入力元として
  //     「都道府県」と「マッチング市区」の **両方** を記録する（片方だと県が欠ける）。
  | 'desired_muni_code_5'
  //   desired_junior_school: customer_list_rows に school_type を判別する列が無いため、
  //     本PRでは小学校区（desired_school）のみ永続化する。中学校区は PR-D で対応。
  | 'desired_junior_school'
  | 'rank'
  | 'status'
  | 'price_low_new_house'
  | 'price_high_new_house'
  | 'price_low_used_house'
  | 'price_high_used_house'
  | 'price_low_new_mansion'
  | 'price_high_new_mansion'
  | 'price_low_used_mansion'
  | 'price_high_used_mansion'
  | 'price_low_land'
  | 'price_high_land'
  | 'price_low_commercial'
  | 'price_high_commercial'

// public.property_types.code（BM-1 で 6 値を INSERT 済み）。
//   ⛔ 値の追加・改名はここではなく DB 側（property_types への INSERT）で行う。
//      ここは「preset の内部 target 名 ↔ code」の橋渡しだけを担う型。
export type PropertyTypeCode =
  | 'new_detached'
  | 'used_detached'
  | 'new_condo'
  | 'used_condo'
  | 'land'
  | 'commercial'

// 価格 6 組（列97〜108）の target 名と property_types.code の対応（唯一の定義・裁定2）。
//   ⚠ preset の内部 target 名（new_house 等）は CSV のヘッダ名に由来する既存の名前で、
//     property_types.code（new_detached 等）とは体系が違う。名前を揃えるリネームはせず、
//     対応表をここ 1 箇所だけに置く（原則19: 二重管理しない）。
//   ⛔ row-extract.ts など利用側はこの表を import して使い、code 文字列を書かない。
export const PRICE_TARGETS: readonly {
  code: PropertyTypeCode
  low: PresetTarget
  high: PresetTarget
}[] = [
  { code: 'new_detached', low: 'price_low_new_house', high: 'price_high_new_house' },
  { code: 'used_detached', low: 'price_low_used_house', high: 'price_high_used_house' },
  { code: 'new_condo', low: 'price_low_new_mansion', high: 'price_high_new_mansion' },
  { code: 'used_condo', low: 'price_low_used_mansion', high: 'price_high_used_mansion' },
  { code: 'land', low: 'price_low_land', high: 'price_high_land' },
  { code: 'commercial', low: 'price_low_commercial', high: 'price_high_commercial' },
]

// 列の解決ルール。
//   - exact       … ヘッダ名の完全一致。同名列は nth 番目（0 始まり・既定 0）を採る。
//   - composite   … 複数ヘッダを順に結合する（address = 都道府県+市区+住所）。
//   - firstPresent… 複数候補のうち最初に見つかった列を採る（status）。
type Rule =
  | { kind: 'exact'; header: string; nth?: number }
  // required に挙げた列が1つでも欠けたら未解決（null）にする。部分解決で
  //   住所が静かに壊れる（例: 「住所」列欠落で address_raw="愛知県"）のを防ぐ。
  | { kind: 'composite'; headers: string[]; required?: string[] }
  | { kind: 'firstPresent'; headers: string[] }

interface FieldSpec {
  target: PresetTarget
  rule: Rule
}

// ハウスドゥ形式の列マッピング定義（唯一の定義）。
//   ※ ヘッダ名は NFKC 正規化後に比較する（全角/半角・合成文字の揺れを吸収）。
const HAUSUDO_FIELDS: readonly FieldSpec[] = [
  { target: 'external_id', rule: { kind: 'exact', header: '顧客番号' } }, // ⛔ 文字列（row-extract が担保）
  { target: 'customer_name', rule: { kind: 'exact', header: '顧客名' } }, // 「顧客名フリガナ」は別 exact
  { target: 'category', rule: { kind: 'exact', header: '顧客種別' } }, // 売主/買主
  {
    // 都道府県+市区+住所 を結合 → normalizeJpAddress（突合エンジン側で正規化）。
    //   「住所」本体が無いと突合が壊れるため required にする（部分解決を許さない）。
    target: 'address',
    rule: { kind: 'composite', headers: ['都道府県', '市区', '住所'], required: ['住所'] },
  },
  { target: 'inquiry_at', rule: { kind: 'exact', header: '受付日' } }, // 反響日
  // O43: 174 列に「最終接触日」列が無いため「更新日」を暫定ソートキーとして last_contact_at に入れる。
  { target: 'last_contact_at', rule: { kind: 'exact', header: '更新日' } },
  // 同名列「反響媒体」が 2 回（col15/col16）。1 個目（nth=0）を採る。
  { target: 'media', rule: { kind: 'exact', header: '反響媒体', nth: 0 } },
  // 「店舗営業担当者」を採る。「店舗営業担当者ID」は別文字列なので exact では拾わない（O49）。
  { target: 'assignee', rule: { kind: 'exact', header: '店舗営業担当者' } },
  // SD-25: 小学校区のみ永続化（school_type 列が無いため）。中学校区は下の desired_junior_school。
  { target: 'desired_school', rule: { kind: 'exact', header: 'マッチング小学校' } },

  // オプトアウト3列＋削除フラグ（O54/O55・c3）。ヘッダ名の完全一致で解決する
  //   （NFKC 正規化後に比較するため全角括弧 '（）' の揺れは吸収される）。列位置は使わない。
  { target: 'opt_out_dm', rule: { kind: 'exact', header: 'DM郵送希望' } },
  {
    target: 'opt_out_mail_magazine',
    rule: { kind: 'exact', header: 'メルマガフラグ（メール営業対象者フラグ）' },
  },
  { target: 'opt_out_mail', rule: { kind: 'exact', header: 'メール禁止フラグ' } },
  { target: 'deleted', rule: { kind: 'exact', header: '削除フラグ' } },

  // 購入希望マッチ（BM-2）。いずれも exact（部分一致で拾わない・O49）。
  //   ⚠ '物件種別' と 'マッチング物件種別' は別文字列なので exact では衝突しない。
  { target: 'property_type', rule: { kind: 'exact', header: 'マッチング物件種別' } }, // 列96
  { target: 'sell_property_type', rule: { kind: 'exact', header: '物件種別' } }, // 列150
  { target: 'desired_land_area_min', rule: { kind: 'exact', header: 'マッチング土地面積下限' } }, // 列109
  { target: 'desired_land_area_max', rule: { kind: 'exact', header: 'マッチング土地面積上限' } }, // 列110
  { target: 'desired_floor_area_min', rule: { kind: 'exact', header: 'マッチング専有面積下限' } }, // 列111
  { target: 'desired_floor_area_max', rule: { kind: 'exact', header: 'マッチング専有面積上限' } }, // 列112

  // --- ここから下は解決＋テストのみ（永続化は PR-D） ---
  { target: 'desired_junior_school', rule: { kind: 'exact', header: 'マッチング中学校' } },
  // 名前→コード変換は PR-D。prefecture_code との複合キーで引くため両列を記録する。
  //   PR-D の変換は両列が揃っている前提のため、片方だけの解決を許さない（両方 required）。
  {
    target: 'desired_muni_code_5',
    rule: {
      kind: 'composite',
      headers: ['都道府県', 'マッチング市区'],
      required: ['都道府県', 'マッチング市区'],
    },
  },
  { target: 'rank', rule: { kind: 'exact', header: '顧客ランク' } }, // CL-10
  { target: 'status', rule: { kind: 'firstPresent', headers: ['顧客ステータス', '新築請負ステータス'] } },
  { target: 'price_low_new_house', rule: { kind: 'exact', header: 'マッチング物件価格下限新築戸建' } },
  { target: 'price_high_new_house', rule: { kind: 'exact', header: 'マッチング物件価格上限新築戸建' } },
  { target: 'price_low_used_house', rule: { kind: 'exact', header: 'マッチング物件価格下限中古戸建' } },
  { target: 'price_high_used_house', rule: { kind: 'exact', header: 'マッチング物件価格上限中古戸建' } },
  { target: 'price_low_new_mansion', rule: { kind: 'exact', header: 'マッチング物件価格下限新築マンション' } },
  { target: 'price_high_new_mansion', rule: { kind: 'exact', header: 'マッチング物件価格上限新築マンション' } },
  { target: 'price_low_used_mansion', rule: { kind: 'exact', header: 'マッチング物件価格下限中古マンション' } },
  { target: 'price_high_used_mansion', rule: { kind: 'exact', header: 'マッチング物件価格上限中古マンション' } },
  { target: 'price_low_land', rule: { kind: 'exact', header: 'マッチング物件価格下限土地' } },
  { target: 'price_high_land', rule: { kind: 'exact', header: 'マッチング物件価格上限土地' } },
  { target: 'price_low_commercial', rule: { kind: 'exact', header: 'マッチング物件価格下限事業用' } },
  { target: 'price_high_commercial', rule: { kind: 'exact', header: 'マッチング物件価格上限事業用' } },
]

// ヘッダ指紋（自動判定用）。ヘッダ名セットの完全一致のみで判定する。
//   ⛔ 列数（174）は条件に含めない: 実 CSV と 174 列の diff が未確認のため、
//      列数固定だと実 CSV で外れる（8/20 議題8）。
const HAUSUDO_FINGERPRINT: readonly string[] = [
  '顧客番号',
  'FC名',
  '顧客種別',
  'マッチング小学校',
  'マッチング中学校',
]

// 未知の presetId が明示指定された場合の例外。呼び出し側（API）で 400 に変換する。
//   ⛔ 黙って detectColumnMapping にフォールバックしない（タイポで O49 の誤検出経路に落ちるのを防ぐ）。
export class UnknownPresetError extends Error {
  readonly presetId: string
  constructor(presetId: string) {
    super(`unknown preset: ${presetId}`)
    this.name = 'UnknownPresetError'
    this.presetId = presetId
  }
}

// プリセット解決の生結果。各ターゲット → 解決した列 index（composite は複数・順序保持）。
//   未解決のターゲットはキーごと存在しない。
export interface ResolvedPreset {
  route: ResolveRoute
  targets: Partial<Record<PresetTarget, number[]>>
}

// 既存パイプライン（extractRows）へ橋渡しする解決結果。
export interface ResolvedMapping {
  // 既存の単一 index マッピング（住所必須チェック等は従来どおりこれを見る）。
  mapping: ColumnMapping
  route: ResolveRoute
  // preset 経路でのみ埋まる抽出補助。extractRows がこちらを優先する。
  extract: {
    // 複合住所（都道府県+市区+住所）。単一 index に収まらないため別で渡す。
    addressColumns?: number[]
    // desired_school（マッチング小学校）の列。
    schoolColumn?: number
    // オプトアウト/削除フラグの列（プリセット経路でのみ埋まる・O54/O55）。
    //   ⛔ heuristic 経路では埋めない＝該当列が無ければ全行 OFF 扱い（列位置決め打ちをしない）。
    optOutDmColumn?: number
    optOutMailMagazineColumn?: number
    optOutMailColumn?: number
    deletedColumn?: number
    // 購入希望マッチ（BM-2）。いずれもプリセット経路でのみ埋まる。
    //   ⛔ heuristic 経路では埋めない＝該当列が無ければ子行を作らない（列位置決め打ちをしない）。
    propertyTypeColumn?: number // 列96『マッチング物件種別』（買い行の第一根拠）
    sellPropertyTypeColumn?: number // 列150『物件種別』（売り行）
    priceColumns?: PriceColumns // 列97〜108（code ごとの下限/上限）
    floorAreaColumns?: AreaColumns // 列111/112『マッチング専有面積下限/上限』
    landAreaColumns?: AreaColumns // 列109/110『マッチング土地面積下限/上限』
  }
  // フルの解決結果（テスト・将来の永続化/警告用）。fallback 時は null。
  preset: ResolvedPreset | null
}

// 面積の下限/上限の列 index（どちらか片方だけの解決もありうる）。
export interface AreaColumns {
  min?: number
  max?: number
}

// 物件種別 code ごとの価格下限/上限の列 index。解決できた code だけキーを持つ。
export type PriceColumns = Partial<Record<PropertyTypeCode, AreaColumns>>

// ヘッダを NFKC 正規化して比較キーにする。
function normHeader(h: string | undefined): string {
  return (h ?? '').normalize('NFKC').trim()
}

// exact: 完全一致する列のうち nth 番目（0 始まり）を返す。無ければ null。
function resolveExact(norm: string[], header: string, nth = 0): number | null {
  const want = normHeader(header)
  let seen = 0
  for (let i = 0; i < norm.length; i++) {
    if (norm[i] === want) {
      if (seen === nth) return i
      seen++
    }
  }
  return null
}

// 1 つの FieldSpec を解決し、列 index の配列（composite 以外は length 1）を返す。
//   解決できない列は含めない（呼び出し側で欠落＝未解決と判定）。
function resolveField(norm: string[], rule: Rule): number[] | null {
  if (rule.kind === 'exact') {
    const idx = resolveExact(norm, rule.header, rule.nth ?? 0)
    return idx == null ? null : [idx]
  }
  if (rule.kind === 'firstPresent') {
    for (const h of rule.headers) {
      const idx = resolveExact(norm, h)
      if (idx != null) return [idx]
    }
    return null
  }
  // composite: 必須列（required）が1つでも欠けたら未解決にする（部分解決の握り潰し防止）。
  for (const h of rule.required ?? []) {
    if (resolveExact(norm, h) == null) return null
  }
  // 見つかった列だけを順序どおりに集める（1 つも無ければ未解決）。
  const cols: number[] = []
  for (const h of rule.headers) {
    const idx = resolveExact(norm, h)
    if (idx != null) cols.push(idx)
  }
  return cols.length ? cols : null
}

// ハウスドゥ形式の全ターゲットを解決する。
export function resolveHausudo(header: string[], route: ResolveRoute): ResolvedPreset {
  const norm = header.map(normHeader)
  const targets: Partial<Record<PresetTarget, number[]>> = {}
  for (const spec of HAUSUDO_FIELDS) {
    const cols = resolveField(norm, spec.rule)
    if (cols) targets[spec.target] = cols
  }
  return { route, targets }
}

// ヘッダ指紋がハウスドゥ形式に一致するか（ヘッダ名セットの完全一致のみ・列数は見ない）。
export function matchesHausudoFingerprint(header: string[]): boolean {
  const set = new Set(header.map(normHeader))
  return HAUSUDO_FINGERPRINT.every((h) => set.has(normHeader(h)))
}

// ResolvedPreset → 既存パイプライン用の ResolvedMapping。
function buildFromPreset(header: string[], route: ResolveRoute): ResolvedMapping {
  const resolved = resolveHausudo(header, route)
  const t = resolved.targets
  const first = (k: PresetTarget): number | undefined => {
    const cols = t[k]
    return cols && cols.length ? cols[0] : undefined
  }

  const mapping: ColumnMapping = {}
  const assign = (mk: CustomerColumnKey, pk: PresetTarget) => {
    const idx = first(pk)
    if (idx != null) mapping[mk] = idx
  }
  assign('external_id', 'external_id')
  assign('customer_name', 'customer_name')
  assign('category', 'category')
  assign('inquiry_at', 'inquiry_at')
  assign('last_contact_at', 'last_contact_at')
  assign('media', 'media')
  assign('assignee', 'assignee')

  // address は複合。mapping.address には住所本体（結合の末尾列）を保険で入れておき、
  //   実際の結合値は extract.addressColumns から extractRows が組み立てる。
  const addrCols = t.address ?? []
  if (addrCols.length) mapping.address = addrCols[addrCols.length - 1]

  // 面積の下限/上限（片方だけ解決できた場合はその片方だけを持つ）。
  //   1 つも解決できなければキーごと undefined にする（空オブジェクトを渡さない）。
  const areaCols = (minKey: PresetTarget, maxKey: PresetTarget): AreaColumns | undefined => {
    const out: AreaColumns = {}
    const min = first(minKey)
    const max = first(maxKey)
    if (min != null) out.min = min
    if (max != null) out.max = max
    return out.min == null && out.max == null ? undefined : out
  }

  // 価格 6 組。対応表（PRICE_TARGETS）を回して code ごとに下限/上限を集める。
  //   ⛔ code 文字列はここで書かず対応表から取る（唯一の定義・裁定2）。
  const priceColumns: PriceColumns = {}
  for (const { code, low, high } of PRICE_TARGETS) {
    const cols = areaCols(low, high)
    if (cols) priceColumns[code] = cols
  }

  return {
    mapping,
    route,
    extract: {
      addressColumns: addrCols.length ? addrCols : undefined,
      schoolColumn: first('desired_school'),
      optOutDmColumn: first('opt_out_dm'),
      optOutMailMagazineColumn: first('opt_out_mail_magazine'),
      optOutMailColumn: first('opt_out_mail'),
      deletedColumn: first('deleted'),
      propertyTypeColumn: first('property_type'),
      sellPropertyTypeColumn: first('sell_property_type'),
      priceColumns: Object.keys(priceColumns).length ? priceColumns : undefined,
      floorAreaColumns: areaCols('desired_floor_area_min', 'desired_floor_area_max'),
      landAreaColumns: areaCols('desired_land_area_min', 'desired_land_area_max'),
    },
    preset: resolved,
  }
}

// 列マッピングを解決する（ハイブリッド: 明示指定 → 指紋照合 → フォールバック）。
//   ⛔ この関数は認可を一切判定しない。API 側で guardFeature を通過した後に呼ぶこと。
//   - presetId 明示あり: 既知なら適用／未知なら UnknownPresetError（呼び出し側で 400）。
//   - presetId 無し    : ヘッダ指紋が一致すれば hausudo、しなければ既存 heuristic。
export function resolveColumnMapping(
  header: string[],
  presetId?: string | null,
): ResolvedMapping {
  if (presetId != null && presetId !== '') {
    if (presetId !== 'hausudo') throw new UnknownPresetError(presetId)
    return buildFromPreset(header, 'preset:hausudo')
  }
  if (matchesHausudoFingerprint(header)) {
    return buildFromPreset(header, 'fingerprint:hausudo')
  }
  return {
    mapping: detectColumnMapping(header),
    route: 'fallback:heuristic',
    extract: {},
    preset: null,
  }
}

// ============================================================
// customer_lists.column_mapping の組み立て（v:3）— BM-2 / c3。
//   ⚠ 監査用のメタデータであり、認可・突合には一切関与しない。
//
// v:2（PR-E 決定1）からの差分は「バージョンを 3 に上げ、BM-2 で解決した列の
//   index 情報を追記する」ことだけ。v:2 のキー（columns / address_columns /
//   resolve_route / preset_id）は名前も意味も一切変えない。
//
//   { v: 3,
//     columns: {論理列→実ヘッダ名},          // v:2 と同じ
//     address_columns?: [実ヘッダ名...],      // v:2 と同じ（複合住所のときだけ）
//     resolve_route, preset_id?,             // v:2 と同じ
//     propertyTypeColumn?: number,           // ← ここから BM-2 の追記（0 始まり index）
//     sellPropertyTypeColumn?: number,
//     priceColumns?: { <property_types.code>: { min?: number; max?: number } },
//     floorAreaColumns?: { min?: number; max?: number },
//     landAreaColumns?: { min?: number; max?: number } }
//
// 読み出し互換（重要）:
//   - 既存の v:2 レコードは **そのまま読める**。presetChoiceFromMapping は v:2/v:3 の
//     双方を受け付ける（本コミットで 1 行だけ緩めた）。
//   - v:3 の追記キーが無いレコード（＝v:2 で取り込んだ名簿・heuristic 経路）は
//     「BM-2 の列が未解決」として扱い、子行を作らない。サマリには警告件数を出す。
//   ⛔ 追記キーに null を入れない（未解決はキーごと省略する。v:2 の流儀を踏襲）。
export function buildColumnMappingV3(
  header: string[],
  mapping: ColumnMapping,
  extract: ResolvedMapping['extract'],
  route: ResolveRoute,
  presetId: string | null,
): Record<string, unknown> {
  const columns: Record<string, string> = {}
  for (const key of Object.keys(mapping) as (keyof ColumnMapping)[]) {
    const idx = mapping[key]
    if (idx != null) columns[key] = header[idx] ?? ''
  }
  const out: Record<string, unknown> = { v: 3, columns, resolve_route: route }
  // 複合住所のときだけ、結合に使った全列名を監査用に残す（末尾1列問題の回避・v:2 と同じ）。
  if (extract.addressColumns && extract.addressColumns.length > 0) {
    out.address_columns = extract.addressColumns.map((idx) => header[idx] ?? '')
  }
  if (presetId != null && presetId !== '') out.preset_id = presetId
  // BM-2 の追記（解決できたものだけ）。
  if (extract.propertyTypeColumn != null) out.propertyTypeColumn = extract.propertyTypeColumn
  if (extract.sellPropertyTypeColumn != null) {
    out.sellPropertyTypeColumn = extract.sellPropertyTypeColumn
  }
  if (extract.priceColumns) out.priceColumns = extract.priceColumns
  if (extract.floorAreaColumns) out.floorAreaColumns = extract.floorAreaColumns
  if (extract.landAreaColumns) out.landAreaColumns = extract.landAreaColumns
  return out
}

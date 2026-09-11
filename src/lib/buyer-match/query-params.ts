// ============================================================
// PR-BM-5: buyer-match 3ルート（summary/cells/rows）共通のクエリ引数パース。
//   純関数のみ（DB・Next のリクエスト型に依存しない）。node:test で単体テスト可能
//   にするため、既存の areas/school-type.ts と同型に切り出す。
//
//   仕様（PM裁定）:
//     - muni_code_5 / school_district_id / property_type / price_min / price_max は
//       すべて任意。未指定は RPC 側の NULL 規約に委ねる（⛔ 正規化・推測はしない・O49）。
//       muni_code_5 は形式検証のルールが定義されていないため、生値をそのまま通す。
//     - property_type は property_types.code の allowlist（6値）外なら不正。
//       allowlist は presets.ts の PRICE_TARGETS から導出する
//       （⛔ 6値を新たに書き下さない・二重管理しない・原則19）。
//     - price_min / price_max は整数のみ。非整数・負値は不正。
//     - school_district_id は uuid 形式のみ。不正は不正。
//   不正時は呼び出し側（各ルート）が {error:'invalid_parameter', parameter:'<name>'} を
//   400 で返す。⛔ 値そのものはレスポンスに含めない（D144）。本モジュールは
//   パラメータ名のみを返し、入力値をそのままエコーしない。
// ============================================================

// ⚠ node --test は '@/' エイリアスを解決できない（node-test-pure-module の教訓）。
//   本モジュールは node:test で直接実行するため相対パスで import する。
import { PRICE_TARGETS, type PropertyTypeCode } from '../customer-list/presets.ts'

// property_types.code の allowlist。PRICE_TARGETS（BM-1で6値INSERT済みのDB値と
// 対応する唯一の定義）から導出する。ここで6値を書き下さない。
export const BUYER_MATCH_PROPERTY_TYPE_CODES: readonly PropertyTypeCode[] = PRICE_TARGETS.map(
  (t) => t.code,
)

const PROPERTY_TYPE_CODE_SET = new Set<string>(BUYER_MATCH_PROPERTY_TYPE_CODES)

// 8-4-4-4-12 の16進形式のみ検証する（RFC4122のバージョン/バリアント桁は問わない。
// 既存の uuid 列は生成方式が複数あるため）。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type BuyerMatchQueryParamName =
  | 'property_type'
  | 'school_district_id'
  | 'price_min'
  | 'price_max'

export interface BuyerMatchQueryParams {
  muniCode5: string | null
  schoolDistrictId: string | null
  propertyType: PropertyTypeCode | null
  priceMin: number | null
  priceMax: number | null
}

export type BuyerMatchQueryParamsResult =
  | { ok: true; params: BuyerMatchQueryParams }
  | { ok: false; parameter: BuyerMatchQueryParamName }

// property_type: 未指定(null)は許可（→RPCへNULL）。allowlist外は undefined（不正）。
export function parsePropertyType(raw: string | null): PropertyTypeCode | null | undefined {
  if (raw === null) return null
  return PROPERTY_TYPE_CODE_SET.has(raw) ? (raw as PropertyTypeCode) : undefined
}

// school_district_id: 未指定(null)は許可。uuid形式でなければ undefined（不正）。
export function parseSchoolDistrictId(raw: string | null): string | null | undefined {
  if (raw === null) return null
  return UUID_RE.test(raw) ? raw : undefined
}

// price_min / price_max 共通の下請け。未指定(null)は許可。
//   10進の非負整数文字列のみ許可（"-1"・"1.5"・""・空白混入・16進表記はすべて不正＝undefined）。
function parseNonNegativeInteger(raw: string | null): number | null | undefined {
  if (raw === null) return null
  if (!/^\d+$/.test(raw)) return undefined
  const n = Number(raw)
  return Number.isSafeInteger(n) ? n : undefined
}

export function parsePriceMin(raw: string | null): number | null | undefined {
  return parseNonNegativeInteger(raw)
}

export function parsePriceMax(raw: string | null): number | null | undefined {
  return parseNonNegativeInteger(raw)
}

// 3ルート共通のエントリポイント。最初に見つかった不正パラメータで打ち切る
// （複数不正でも 400 の parameter は1件分のみ）。
export function parseBuyerMatchQueryParams(
  searchParams: Pick<URLSearchParams, 'get'>,
): BuyerMatchQueryParamsResult {
  const propertyType = parsePropertyType(searchParams.get('property_type'))
  if (propertyType === undefined) return { ok: false, parameter: 'property_type' }

  const schoolDistrictId = parseSchoolDistrictId(searchParams.get('school_district_id'))
  if (schoolDistrictId === undefined) return { ok: false, parameter: 'school_district_id' }

  const priceMin = parsePriceMin(searchParams.get('price_min'))
  if (priceMin === undefined) return { ok: false, parameter: 'price_min' }

  const priceMax = parsePriceMax(searchParams.get('price_max'))
  if (priceMax === undefined) return { ok: false, parameter: 'price_max' }

  return {
    ok: true,
    params: {
      // muni_code_5 は検証ルールが定義されていないため正規化せず生値を通す（O49）。
      muniCode5: searchParams.get('muni_code_5'),
      schoolDistrictId,
      propertyType,
      priceMin,
      priceMax,
    },
  }
}

// ============================================================
// PR-BM-9b-1: cards ルート専用のクエリ引数パース（裁定57/65/67）。
//   summary/cells/rows と挙動を揃えつつ、cards だけの2点を反映する:
//     - property_type は【必須】。未指定(null)も allowlist 外も 400（裁定57）。
//     - school_district_id は【受け取らない】。クエリに来ても無視し（400 にもしない）、
//       RPC には常に null を渡す（裁定67・33/46）。ここでは get すらしない。
//   muni_code_5 は既存3ルートと同じ「任意・形式検証なし・生値透過」（裁定65・O49）。
//   price_min / price_max は既存と同じ非負整数（parsePriceMin/parsePriceMax を流用）。
//   ⛔ 既存の parsePropertyType（null 許可版）は変更しない。必須判定はここで行う。
//   ⛔ 不正値そのものは結果に含めない（D144）。返すのはパラメータ名のみ。
// ============================================================

export type BuyerMatchCardsQueryParamName = 'property_type' | 'price_min' | 'price_max'

export interface BuyerMatchCardsQueryParams {
  // school_district_id は保持しない（cards では受け取らない・裁定67）。
  muniCode5: string | null
  propertyType: PropertyTypeCode
  priceMin: number | null
  priceMax: number | null
}

export type BuyerMatchCardsQueryParamsResult =
  | { ok: true; params: BuyerMatchCardsQueryParams }
  | { ok: false; parameter: BuyerMatchCardsQueryParamName }

export function parseBuyerMatchCardsQueryParams(
  searchParams: Pick<URLSearchParams, 'get'>,
): BuyerMatchCardsQueryParamsResult {
  // property_type は必須。未指定(null)も allowlist 外も 400（裁定57）。
  const rawPropertyType = searchParams.get('property_type')
  if (rawPropertyType === null) return { ok: false, parameter: 'property_type' }
  const propertyType = parsePropertyType(rawPropertyType)
  if (propertyType === undefined || propertyType === null) {
    return { ok: false, parameter: 'property_type' }
  }

  const priceMin = parsePriceMin(searchParams.get('price_min'))
  if (priceMin === undefined) return { ok: false, parameter: 'price_min' }

  const priceMax = parsePriceMax(searchParams.get('price_max'))
  if (priceMax === undefined) return { ok: false, parameter: 'price_max' }

  return {
    ok: true,
    params: {
      // muni_code_5 は検証せず生値透過（裁定65・O49）。
      muniCode5: searchParams.get('muni_code_5'),
      // ⛔ school_district_id は get せず、RPC 側で常に null を渡す（裁定67）。
      propertyType,
      priceMin,
      priceMax,
    },
  }
}

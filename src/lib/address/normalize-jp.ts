// ============================================================
// M2-5b / CL-28: 住所正規化（TS 前処理）— 8市一般化版。
//   Phase6 PoC（/Users/gomez/okazaki-mansion-db の src/normalize/address.py）の
//   決定的正規化を、岡崎市ハードコードから公開8市へ一般化して移植したもの。
//
//   役割分担（CL-28 で確定）:
//     正規化（この層）= TS 前処理。住所文字列 → (muni_code_5, town, chome, ban, go)
//     突合            = Postgres 関数（geo_reference_points との完全一致 ＋ ST_Contains）
//   よってこのモジュールは DB を一切参照しない純ロジック（React 非依存・node --test 可能）。
//
//   ⚠ 原則1/5（確定と推定を混ぜない・推測での補完はしない）:
//     - 表記ゆれの吸収と、明示された数値の分解までしか行わない。
//     - 判らないものは status で返す。勝手に丁目や番地を補わない。
//     - 例外は投げない。CSV 取込（顧客名簿）で1行の失敗が全体を止めないよう、
//       PoC の AddressNormalizationError 相当は status='invalid' + reason に写像する。
//
//   ⚠ 文字レベルの正規化は customer-list の normalizeAddress を再利用する。
//     CL-28「正規化は TS の1箇所」を守るため、NFKC・旧字体・ハイフン・大字/字・空白の
//     扱いを二重に定義しない。
//     突合は「両側に同じ規則を適用して初めて一致する」ため、PR#2 の SQL 側でも
//     NFKC・旧字体・ハイフン類・長音「ー」→'-'・大字/字除去・空白除去を同一に適用すること。
//     片側だけ適用すると静かに不一致になる。
//     特に長音: normalizeAddress は「ー」も '-' に統一する。位置参照情報側にも長音を含む
//     小字が実在する（実測 35行・豊田市 幸海町「ゴード」「ヲーツケ」）。
//
//   【PR#2（突合関数）への受け渡し契約】
//     - town は「丁目を除いた町字名」。chome は算用数字の文字列（'1'）。
//     - 位置参照情報（geo_reference_points）の town_raw は丁目を含む生値で、
//       実測 73,495行すべてが漢数字丁目（算用数字は0件）。よって SQL 側で
//       town_raw → (町字名, 丁目) へ分解する際も、ここと同じ規則で漢数字を算用数字化する。
//     - 小字（subarea_raw）は実測で岡崎95%・豊橋/豊田は過半に存在する。この層では
//       town と小字を分離しない（住所文字列だけでは境界を確定できないため・原則1）。
//       town には「町字名＋小字」が連結されたまま入りうる。分離の可否判定は突合側で
//       マスタ（実在する町字名・小字名）と突き合わせて行う。
// ============================================================

import { normalizeAddress } from '../customer-list/normalize.ts'
import { PREFECTURES } from '../customer-list/prefectures.ts'
import {
  TARGET_MUNI_NAMES_BY_LENGTH_DESC,
  findTargetMunicipalities,
  type TargetMunicipality,
} from './target-munis.ts'

// 正規化の結果種別。
//   normalized   : 対象8市の住所として (town, chome, ban, go) まで確定できた
//   out_of_scope : 住所としては読めたが、対象8市を特定できない（対象外の市・市名なし）
//   ambiguous    : 同名市が複数候補で一意に定まらない（都道府県省略時・府中市問題）
//   invalid      : 住所として解釈できない（空・数値表記の破綻・町名なし）
export type JpAddressStatus =
  | 'normalized'
  | 'out_of_scope'
  | 'ambiguous'
  | 'invalid'

export interface NormalizedJpAddress {
  status: JpAddressStatus
  /** 入力を文字レベル正規化しただけの住所全体（常に返す。空入力時は ''）。 */
  addressNormalized: string
  prefecture: string | null
  prefCode: string | null
  municipality: string | null
  muniCode5: string | null
  /** 丁目を除いた町字名（小字が連結されたままの場合がある）。 */
  town: string | null
  /** 丁目。算用数字の文字列。無ければ null。 */
  chome: string | null
  /** 番地。算用数字の文字列。無ければ null。 */
  ban: string | null
  /** 号。算用数字の文字列。無ければ null。 */
  go: string | null
  /** 正準表記。status='normalized' のときのみ。 */
  addressCanonical: string | null
  /** 突合キー `muniCode5|town|chome|ban|go`。status='normalized' のときのみ。 */
  normalizationKey: string | null
  /** ambiguous のときの市区町村候補（断定しないための候補保持・原則5）。 */
  candidates: TargetMunicipality[]
  /** normalized 以外のとき、なぜそうなったかの根拠（UI/ログ用）。 */
  reason: string | null
}

// 数字として扱う文字（算用数字＋漢数字＋大字）。PoC の _NUMBER_CHARS と同値。
const NUMBER_CHARS = '0-9〇零一二三四五六七八九十百千壱弐参'
const NUMBER_PATTERN = `[${NUMBER_CHARS}]+`

// 「…N丁目…」の分解。town を非貪欲にすることで、町名自体に漢数字を含む
//   「十王町一丁目」「百々町」（実測で実在）でも丁目だけを切り出せる。
const CHOME_PATTERN = new RegExp(
  `^(?<town>.+?)(?<chome>${NUMBER_PATTERN})丁目(?<rest>.*)$`,
)

// 丁目表記が無く、末尾が数値列（番地・号）で終わる住所の分解。
const NUMERIC_SUFFIX_PATTERN = new RegExp(
  `^(?<town>.+?)(?<suffix>${NUMBER_PATTERN}[${NUMBER_CHARS}丁目番地号の\\-]*)$`,
)

const KANJI_DIGITS: Record<string, number> = {
  〇: 0,
  零: 0,
  一: 1,
  壱: 1,
  二: 2,
  弐: 2,
  三: 3,
  参: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

const KANJI_UNITS: Record<string, number> = {
  十: 10,
  百: 100,
  千: 1000,
}

// 町名として残ってはいけない残骸（分解漏れの検知に使う）。
const SUFFIX_MARKERS = ['丁目', '番地', '番', '号'] as const

// 数値1件を算用数字の文字列へ。解釈できなければ null（推測しない）。
function parseJpNumber(value: string): string | null {
  let num: number

  if (/^[0-9]+$/.test(value)) {
    num = Number(value)
  } else if ([...value].every((ch) => ch in KANJI_DIGITS)) {
    // 位取りなしの並び（「一二三」= 123）。桁を連結して読む。
    num = Number([...value].map((ch) => String(KANJI_DIGITS[ch])).join(''))
  } else {
    // 位取りあり（「十一」= 11 / 「二十」= 20）。
    let total = 0
    let pending: number | null = null
    let lastUnit = 10_000

    for (const ch of value) {
      if (ch in KANJI_DIGITS) {
        if (pending !== null) return null // 「一二十」のような並びは解釈しない
        pending = KANJI_DIGITS[ch]
        continue
      }
      const unit = KANJI_UNITS[ch]
      if (unit === undefined || unit >= lastUnit) return null
      total += (pending ?? 1) * unit
      pending = null
      lastUnit = unit
    }
    num = total + (pending ?? 0)
  }

  if (!Number.isFinite(num) || num <= 0) return null // 0丁目・負値は住所として認めない
  return String(num)
}

// 「2番地の3号」のような接尾辞をハイフン区切りのトークン列へ。
function tokenizeNumericSuffix(suffix: string): string[] | null {
  let s = suffix
    .replaceAll('番地の', '-')
    .replaceAll('番地', '-')
    .replaceAll('番', '-')
    .replaceAll('号', '')
    .replaceAll('の', '-')
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '')

  if (!s) return []
  const tokens = s.split('-')
  if (tokens.some((t) => !t)) return null
  return tokens
}

interface NumericParts {
  chome: string | null
  ban: string | null
  go: string | null
}

// 数値部の解釈。explicitChome=true は「丁目」が明示済みで残りが番・号のケース。
//   ⚠ 丁目が明示されない2要素（「本町通2-3」）は 番地-号 と読む。丁目-番地 と
//     読み分けるにはマスタ参照が要るため、ここで推測しない（PoC と同じ判断・原則1）。
function parseNumericSuffix(
  suffix: string,
  explicitChome: boolean,
): NumericParts | null {
  const tokens = tokenizeNumericSuffix(suffix)
  if (tokens === null) return null

  const nums: string[] = []
  for (const t of tokens) {
    const n = parseJpNumber(t)
    if (n === null) return null
    nums.push(n)
  }

  if (explicitChome) {
    if (nums.length > 2) return null
    return { chome: null, ban: nums[0] ?? null, go: nums[1] ?? null }
  }
  if (nums.length === 3) return { chome: nums[0], ban: nums[1], go: nums[2] }
  if (nums.length === 2) return { chome: null, ban: nums[0], go: nums[1] }
  if (nums.length === 1) return { chome: null, ban: nums[0], go: null }
  if (nums.length === 0) return { chome: null, ban: null, go: null }
  return null
}

interface TownParts extends NumericParts {
  town: string
}

// 市区町村を除いた残余を「町字名 ＋ 丁目/番地/号」へ分解する。
function splitTownAndNumbers(remainder: string): TownParts | null {
  const chomeMatch = CHOME_PATTERN.exec(remainder)
  if (chomeMatch?.groups) {
    const chome = parseJpNumber(chomeMatch.groups.chome)
    if (chome === null) return null
    const rest = parseNumericSuffix(chomeMatch.groups.rest, true)
    if (rest === null) return null
    return { town: chomeMatch.groups.town, chome, ban: rest.ban, go: rest.go }
  }

  const suffixMatch = NUMERIC_SUFFIX_PATTERN.exec(remainder)
  if (suffixMatch?.groups) {
    const parts = parseNumericSuffix(suffixMatch.groups.suffix, false)
    if (parts === null) return null
    return { town: suffixMatch.groups.town, ...parts }
  }

  // 数字を含むのに上のどちらにも当てはまらない ＝ 解釈できない表記。
  if (/[0-9]/.test(remainder)) return null
  return { town: remainder, chome: null, ban: null, go: null }
}

// 正準表記（PoC の address_norm 相当）。
function canonicalAddress(
  pref: string,
  muni: string,
  parts: TownParts,
): string {
  let s = `${pref}${muni}${parts.town}`
  if (parts.chome !== null) s += `${parts.chome}丁目`
  if (parts.ban !== null) s += `${parts.ban}番地`
  if (parts.go !== null) s += `${parts.go}号`
  return s
}

function fail(
  status: Exclude<JpAddressStatus, 'normalized'>,
  addressNormalized: string,
  reason: string,
  extra?: Partial<NormalizedJpAddress>,
): NormalizedJpAddress {
  return {
    status,
    addressNormalized,
    prefecture: null,
    prefCode: null,
    municipality: null,
    muniCode5: null,
    town: null,
    chome: null,
    ban: null,
    go: null,
    addressCanonical: null,
    normalizationKey: null,
    candidates: [],
    reason,
    ...extra,
  }
}

/**
 * 住所文字列を対象8市の構造化住所へ正規化する（例外を投げない純関数）。
 *
 * 都道府県が明示されていればそれをアンカーに市区町村を絞り込む（府中市問題）。
 * 省略されていて同名市が複数該当する場合は断定せず ambiguous を返す。
 */
export function normalizeJpAddress(
  input: string | null | undefined,
): NormalizedJpAddress {
  if (typeof input !== 'string') {
    return fail('invalid', '', '住所が文字列ではありません')
  }

  const cleaned = normalizeAddress(input)
  if (!cleaned) {
    return fail('invalid', '', '住所が空です')
  }

  // ① 都道府県の切り出し（先頭一致・マスタ由来の正式名のみ）。
  const pref = PREFECTURES.find((p) => cleaned.startsWith(p.name)) ?? null
  const afterPref = pref ? cleaned.slice(pref.name.length) : cleaned

  // ② 市区町村の特定。対象8市の名を最長一致で探し、都道府県が判っていれば絞る。
  //    ⚠ 先頭一致に限定する。町字名の中に市名が現れる住所（例:「…岡崎町」）を
  //      市区町村として誤検出しないため（原則2）。
  let matchedName: string | null = null
  for (const name of TARGET_MUNI_NAMES_BY_LENGTH_DESC) {
    if (afterPref.startsWith(name)) {
      matchedName = name
      break
    }
  }
  if (matchedName === null) {
    return fail(
      'out_of_scope',
      cleaned,
      pref
        ? `対象8市の市区町村名が住所の先頭にありません（${pref.name}）`
        : '対象8市の市区町村名が住所の先頭にありません',
    )
  }

  const candidates = findTargetMunicipalities(matchedName, pref?.code ?? null)
  if (candidates.length === 0) {
    // 市名は対象8市に存在するが、明示された都道府県が一致しない
    //   （例:「岐阜県岡崎市…」）。推測で愛知県に寄せない（原則2）。
    return fail(
      'out_of_scope',
      cleaned,
      `${pref?.name ?? ''}${matchedName} は対象8市に含まれません`,
    )
  }
  if (candidates.length > 1) {
    // 都道府県が省略され、同名市が複数県にある場合。断定しない（原則5）。
    return fail(
      'ambiguous',
      cleaned,
      `${matchedName} は複数の都道府県に存在します。都道府県の明示が必要です`,
      { candidates: [...candidates] },
    )
  }

  const muni = candidates[0]
  const remainder = afterPref.slice(matchedName.length)
  if (!remainder) {
    return fail('invalid', cleaned, '町字名がありません')
  }

  // ③ 町字名と丁目/番地/号の分解。
  const parts = splitTownAndNumbers(remainder)
  if (parts === null) {
    return fail('invalid', cleaned, `住所の数値表記を解釈できません: ${remainder}`)
  }
  if (!parts.town) {
    return fail('invalid', cleaned, '町字名がありません')
  }
  if (SUFFIX_MARKERS.some((marker) => parts.town.includes(marker))) {
    // 「丁目」「番地」等が町名側に残る ＝ 分解しきれていない表記。
    return fail('invalid', cleaned, `町字名または接尾辞を解釈できません: ${parts.town}`)
  }

  return {
    status: 'normalized',
    addressNormalized: cleaned,
    prefecture: muni.prefName,
    prefCode: muni.prefCode,
    municipality: muni.muniName,
    muniCode5: muni.muniCode5,
    town: parts.town,
    chome: parts.chome,
    ban: parts.ban,
    go: parts.go,
    addressCanonical: canonicalAddress(muni.prefName, muni.muniName, parts),
    normalizationKey: [
      muni.muniCode5,
      parts.town,
      parts.chome ?? '',
      parts.ban ?? '',
      parts.go ?? '',
    ].join('|'),
    candidates: [],
    reason: null,
  }
}

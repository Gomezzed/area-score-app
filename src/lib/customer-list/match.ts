// ============================================================
// 住所 → 町域 突合エンジン（React 非依存の純ロジック）。
//   DB から供給される町域マスタ（TownRecord[]）だけを見て、住所文字列を
//   confirmed / ambiguous / out_of_scope の3値で判定する。
//
//   ⚠ 原則1/5（確定と推定を混ぜない・断定しない・推測での一致は禁止）:
//     - 一意に prefix 一致した町域のみ confirmed。
//     - 同名異町域など候補が複数なら ambiguous（候補を保持し、断定しない）。
//     - 市区町村を特定できない / 町域データ未整備なら out_of_scope（参考値）。
//   推測補完は一切行わない。判定はすべて「マスタに実在する町名の prefix 一致」。
// ============================================================

import { normalizeAddress, normalizeTownName } from './normalize.ts'
import { detectPrefectureCode } from './prefectures.ts'
import type {
  MatchCandidate,
  MatchResult,
  TownRecord,
} from './types.ts'

// インデックス内の市区町村1件。
//   prefecture_code は都道府県アンカーの絞り込みに使う。null は「都道府県不明」で、
//   その場合は絞り込み対象から除外しない（後方互換: 解決母集合が code を持たない構成）。
export interface MuniEntry {
  id: string
  normName: string // 正規化後の市区町村名（照合キー）
  name: string // 原表記（候補の可読名に使う）
  prefecture_code: string | null
}

// マスタを突合しやすい形に前計算したインデックス。
export interface TownIndex {
  // 市区町村一覧。名の長い順で走査し最長一致を採る。
  municipalities: MuniEntry[]
  // municipality_id → その自治体の町域（正規化名つき）
  townsByMuni: Map<string, Array<{ normName: string; rec: TownRecord }>>
}

// TownRecord[] から TownIndex を構築する。
//   allMunicipalities（省略可）: 自治体解決に使う「全市区町村」の一覧（id, name）。
//     指定時はこちらを municipality 解決の母集合とする（例: municipalities テーブル
//     約1,916件）。これにより町域データを持たない市（豊田市・名古屋市など）でも
//     住所から municipality_id を確定でき、out_of_scope でも id を保持できる。
//     省略時は records 由来の自治体名から解決（＝町域データを持つ自治体のみ・既存挙動）。
//   ※ 町域照合(townsByMuni)は常に records から作る（データのある自治体のみ）。
export function buildTownIndex(
  records: TownRecord[],
  allMunicipalities?: Array<{ id: string; name: string; prefecture_code?: string | null }>,
): TownIndex {
  const muniMap = new Map<string, MuniEntry>() // id → MuniEntry
  const townsByMuni = new Map<string, Array<{ normName: string; rec: TownRecord }>>()

  for (const rec of records) {
    const normName = normalizeTownName(rec.town_name)
    if (!normName) continue
    const list = townsByMuni.get(rec.municipality_id) ?? []
    list.push({ normName, rec })
    townsByMuni.set(rec.municipality_id, list)
  }

  // 自治体解決の母集合: 明示指定があればそれ、無ければ records 由来（既存挙動）。
  //   records 由来には prefecture_code が無いため null（＝都道府県不明で絞り込み対象外）。
  if (allMunicipalities && allMunicipalities.length > 0) {
    for (const m of allMunicipalities) {
      if (!muniMap.has(m.id)) {
        muniMap.set(m.id, {
          id: m.id,
          normName: normalizeTownName(m.name),
          name: m.name,
          prefecture_code: m.prefecture_code ?? null,
        })
      }
    }
  } else {
    for (const rec of records) {
      if (!muniMap.has(rec.municipality_id)) {
        muniMap.set(rec.municipality_id, {
          id: rec.municipality_id,
          normName: normalizeTownName(rec.municipality_name),
          name: rec.municipality_name,
          prefecture_code: null,
        })
      }
    }
  }

  const municipalities = Array.from(muniMap.values()).filter((m) => m.normName) // 空名は除外
  // 最長一致を優先するため、名の長い順に並べておく（'尾張旭市' が '旭市' より先）。
  municipalities.sort((a, b) => b.normName.length - a.normName.length)

  return { municipalities, townsByMuni }
}

// 市区町村の特定結果（残余つき）。
interface MuniMatch {
  entry: MuniEntry
  remainder: string
}

// 正規化済み住所から、含まれる市区町村を「都道府県アンカー＋最長一致」で特定する。
//   ① 住所先頭に都道府県があれば、その都道府県の自治体だけに候補を絞る（府中市問題の解消）。
//      prefecture_code が不明(null)の自治体は絞り込みで除外しない（後方互換）。
//   ② 絞った母集合から最長一致する市区町村名を採る。同名（例: 府中市が複数）で
//      最長一致長が並んだ場合は、一意に定まらないので候補を全て返す（呼び出し側で ambiguous）。
//   都道府県が省略され、かつ同名市が1つだけなら従来どおり一意に解決される。
function identifyMunicipalities(normAddr: string, index: TownIndex): MuniMatch[] {
  const prefCode = detectPrefectureCode(normAddr)
  let bestLen = 0
  let best: MuniMatch[] = []
  for (const entry of index.municipalities) {
    if (!entry.normName) continue
    // 都道府県アンカー: 都道府県が判明かつ自治体の都道府県が異なるものだけを除外。
    //   自治体側の prefecture_code が不明(null)なら除外しない（母集合が code 未指定の構成でも動く）。
    if (prefCode && entry.prefecture_code && entry.prefecture_code !== prefCode) {
      continue
    }
    const at = normAddr.indexOf(entry.normName)
    if (at < 0) continue
    const len = entry.normName.length
    const remainder = normAddr.slice(at + len)
    if (len > bestLen) {
      bestLen = len
      best = [{ entry, remainder }]
    } else if (len === bestLen) {
      best.push({ entry, remainder })
    }
  }
  return best
}

// 住所文字列から市区町村だけを解決して municipality_id を返す（純関数）。
//   一意に定まる場合のみ id を返す。定まらない/見つからない場合は null。
//   （複数候補が残る住所は matchAddress 側で ambiguous になる。）
export function resolveMunicipalityId(
  addressRaw: string | null | undefined,
  index: TownIndex,
): string | null {
  const ids = resolveMunicipalityIds(addressRaw, index)
  return ids.length === 1 ? ids[0] : null
}

// 住所文字列から候補となる市区町村 id を全て返す（純関数）。
//   import の「解決済み id のみビューを .in() で絞る」前段に使う（町域データ取得の母集合）。
//   複数候補（府中市問題等）でも取りこぼさないよう全 id を返す（confirmed 判定は matchAddress が担う）。
export function resolveMunicipalityIds(
  addressRaw: string | null | undefined,
  index: TownIndex,
): string[] {
  const normAddr = normalizeAddress(addressRaw)
  if (!normAddr) return []
  return identifyMunicipalities(normAddr, index).map((m) => m.entry.id)
}

// 残余文字列に対して prefix 一致する町域を探す。
//   最長 prefix の町名グループを候補として返す（同長は全て候補）。
function matchTowns(
  remainder: string,
  towns: Array<{ normName: string; rec: TownRecord }>,
): Array<{ normName: string; rec: TownRecord }> {
  let bestLen = 0
  let best: Array<{ normName: string; rec: TownRecord }> = []
  for (const t of towns) {
    if (!t.normName) continue
    if (remainder.startsWith(t.normName)) {
      if (t.normName.length > bestLen) {
        bestLen = t.normName.length
        best = [t]
      } else if (t.normName.length === bestLen) {
        best.push(t)
      }
    }
  }
  return best
}

// 住所1件を突合する。engine の唯一の入口。
export function matchAddress(
  addressRaw: string | null | undefined,
  index: TownIndex,
): MatchResult {
  const normAddr = normalizeAddress(addressRaw)
  const base: MatchResult = {
    status: 'out_of_scope',
    municipality_id: null,
    town_name_normalized: null,
    candidates: [],
    address_normalized: normAddr,
  }

  if (!normAddr) return base

  // 1. 市区町村の特定（都道府県アンカー＋最長一致）。
  const munis = identifyMunicipalities(normAddr, index)

  // 1a. 特定不可 → out_of_scope。
  if (munis.length === 0) return base

  // 1b. 市区町村が一意に定まらない（都道府県省略で同名市が複数＝府中市問題）→ ambiguous。
  //     断定せず候補を保持する（原則1/5）。町域は未確定なので town_* は null。
  if (munis.length > 1) {
    base.status = 'ambiguous'
    base.municipality_id = null // どの市か未確定
    base.candidates = munis.map<MatchCandidate>((m) => ({
      municipality_id: m.entry.id,
      municipality_name: m.entry.name,
      prefecture_code: m.entry.prefecture_code,
      town_id: null,
      town_name: null,
      office_name: null,
    }))
    return base
  }

  // 1c. 一意に市区町村を特定できた。
  const muni = munis[0]
  base.municipality_id = muni.entry.id

  // 2. 町域の照合。町域データ未整備（対象外の市）or prefix 不一致 → out_of_scope（muni は保持）。
  const towns = index.townsByMuni.get(muni.entry.id) ?? []
  const matched = matchTowns(muni.remainder, towns)
  if (matched.length === 0) {
    return base // 市区町村は判ったが町域を確定できず（参考値）
  }

  // 3. 一意なら confirmed。複数候補（同名異町域など）は ambiguous。
  //    重複 town_id を畳んで実体数で判定する。
  const uniqueByTownId = new Map<number, TownRecord>()
  for (const m of matched) uniqueByTownId.set(m.rec.town_id, m.rec)

  if (uniqueByTownId.size === 1) {
    base.status = 'confirmed'
    base.town_name_normalized = matched[0].normName
    return base
  }

  // 候補複数 → ambiguous。断定せず候補を保持する（原則5）。
  base.status = 'ambiguous'
  const candidates: MatchCandidate[] = Array.from(uniqueByTownId.values()).map(
    (rec) => ({
      municipality_id: rec.municipality_id,
      town_id: rec.town_id,
      town_name: rec.town_name,
      office_name: rec.office_name,
    }),
  )
  base.candidates = candidates
  return base
}

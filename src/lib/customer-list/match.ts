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
import type {
  MatchCandidate,
  MatchResult,
  TownRecord,
} from './types.ts'

// マスタを突合しやすい形に前計算したインデックス。
export interface TownIndex {
  // 市区町村: 正規化名 → { id, 正規化名 }。名の長い順で走査し最長一致を採る。
  municipalities: Array<{ id: string; normName: string }>
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
  allMunicipalities?: Array<{ id: string; name: string }>,
): TownIndex {
  const muniMap = new Map<string, string>() // id → normName
  const townsByMuni = new Map<string, Array<{ normName: string; rec: TownRecord }>>()

  for (const rec of records) {
    const normName = normalizeTownName(rec.town_name)
    if (!normName) continue
    const list = townsByMuni.get(rec.municipality_id) ?? []
    list.push({ normName, rec })
    townsByMuni.set(rec.municipality_id, list)
  }

  // 自治体解決の母集合: 明示指定があればそれ、無ければ records 由来（既存挙動）。
  if (allMunicipalities && allMunicipalities.length > 0) {
    for (const m of allMunicipalities) {
      if (!muniMap.has(m.id)) muniMap.set(m.id, normalizeTownName(m.name))
    }
  } else {
    for (const rec of records) {
      if (!muniMap.has(rec.municipality_id)) {
        muniMap.set(rec.municipality_id, normalizeTownName(rec.municipality_name))
      }
    }
  }

  const municipalities = Array.from(muniMap.entries())
    .map(([id, normName]) => ({ id, normName }))
    .filter((m) => m.normName) // 空名は解決対象から除外
  // 最長一致を優先するため、名の長い順に並べておく（'尾張旭市' が '旭市' より先）。
  municipalities.sort((a, b) => b.normName.length - a.normName.length)

  return { municipalities, townsByMuni }
}

// 正規化済み住所から、含まれる市区町村（最長一致）を特定して残余を返す。
//   見つからなければ null。
function identifyMunicipality(
  normAddr: string,
  index: TownIndex,
): { id: string; remainder: string } | null {
  for (const muni of index.municipalities) {
    if (!muni.normName) continue
    const at = normAddr.indexOf(muni.normName)
    if (at >= 0) {
      const remainder = normAddr.slice(at + muni.normName.length)
      return { id: muni.id, remainder }
    }
  }
  return null
}

// 住所文字列から市区町村だけを解決して municipality_id を返す（純関数）。
//   町域データの有無に依らず、TownIndex.municipalities（＝解決母集合）から最長一致で確定。
//   import の「解決済み id のみビューを .in() で絞る」前段に使う（全取得の廃止）。
//   解決できなければ null。
export function resolveMunicipalityId(
  addressRaw: string | null | undefined,
  index: TownIndex,
): string | null {
  const normAddr = normalizeAddress(addressRaw)
  if (!normAddr) return null
  const muni = identifyMunicipality(normAddr, index)
  return muni ? muni.id : null
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

  // 1. 市区町村の特定（解決母集合＝index.municipalities の最長一致）。特定不可 → out_of_scope。
  const muni = identifyMunicipality(normAddr, index)
  if (!muni) return base

  base.municipality_id = muni.id

  // 2. 町域の照合。町域データ未整備（対象外の市）or prefix 不一致 → out_of_scope（muni は保持）。
  const towns = index.townsByMuni.get(muni.id) ?? []
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

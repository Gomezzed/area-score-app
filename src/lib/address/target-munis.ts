// ============================================================
// M2-5b / SD-32・CL-28: 住所正規化の対象自治体（公開8市）固定辞書。
//   複合キー = (都道府県名, 市区町村名) → 5桁コード。
//
//   ⚠ 原則2「都道府県違いの同名市を絶対に拾わない」:
//     市区町村名だけをキーにしない。必ず (都道府県名, 市区町村名) の複合キーで引く。
//     府中市（東京都/広島県）のような同名市を、都道府県アンカーなしで確定させない。
//
//   ⚠ 唯一の正は ETL 側の固定辞書:
//     `scripts/etl/load_geo_reference_points.py` の TARGET_MUNIS（CC-B レーン）。
//     geo_reference_points.muni_code_5 はその辞書で解決されて格納されている。
//     Python から TS へ import はできないため、ここは「同値の転記」であり、
//     8市の増減が起きたときは両方を同時に更新する（片側だけ直すと突合が静かに壊れる）。
//     実測（2026-08-17・本番 DB）: geo_reference_points の muni_code_5 は
//     下記8件と完全一致（distinct = 8）。
// ============================================================

export interface TargetMunicipality {
  /** 5桁の全国地方公共団体コード（municipalities.city_code と整合） */
  muniCode5: string
  /** 都道府県コード2桁（prefectures.code と整合） */
  prefCode: string
  /** 都道府県名（原表記） */
  prefName: string
  /** 市区町村名（原表記） */
  muniName: string
}

// 公開8市。ETL の TARGET_MUNIS と同順・同値。
export const TARGET_MUNICIPALITIES: ReadonlyArray<TargetMunicipality> = [
  { muniCode5: '23201', prefCode: '23', prefName: '愛知県', muniName: '豊橋市' },
  { muniCode5: '23202', prefCode: '23', prefName: '愛知県', muniName: '岡崎市' },
  { muniCode5: '23210', prefCode: '23', prefName: '愛知県', muniName: '刈谷市' },
  { muniCode5: '23211', prefCode: '23', prefName: '愛知県', muniName: '豊田市' },
  { muniCode5: '23212', prefCode: '23', prefName: '愛知県', muniName: '安城市' },
  { muniCode5: '23225', prefCode: '23', prefName: '愛知県', muniName: '知立市' },
  { muniCode5: '23227', prefCode: '23', prefName: '愛知県', muniName: '高浜市' },
  { muniCode5: '46201', prefCode: '46', prefName: '鹿児島県', muniName: '鹿児島市' },
]

// 市区町村名 → 候補（同名市が複数県にある場合に備え配列で保持する）。
//   現在の8市に同名衝突は無いが、辞書が増えたときに「1件だけ返す」実装が
//   静かに誤判定へ変わらないよう、最初から配列で扱う（原則2）。
const BY_MUNI_NAME = new Map<string, TargetMunicipality[]>()
for (const m of TARGET_MUNICIPALITIES) {
  const list = BY_MUNI_NAME.get(m.muniName) ?? []
  list.push(m)
  BY_MUNI_NAME.set(m.muniName, list)
}

/**
 * 市区町村名（正規化済み・原表記いずれも純漢字なので同値）で対象8市を引く。
 * prefCode を渡すとその都道府県に限定する（都道府県アンカー）。
 * 該当なしは空配列。複数返る場合は呼び出し側で ambiguous 扱いにすること。
 */
export function findTargetMunicipalities(
  muniName: string,
  prefCode?: string | null,
): TargetMunicipality[] {
  const found = BY_MUNI_NAME.get(muniName) ?? []
  if (!prefCode) return found
  return found.filter((m) => m.prefCode === prefCode)
}

// 市区町村名の最長一致走査用（長い名から先に試す）。
//   例: 「西尾市」と「尾市」のような包含関係が将来入っても取り違えない。
export const TARGET_MUNI_NAMES_BY_LENGTH_DESC: ReadonlyArray<string> = Array.from(
  new Set(TARGET_MUNICIPALITIES.map((m) => m.muniName)),
).sort((a, b) => b.length - a.length)

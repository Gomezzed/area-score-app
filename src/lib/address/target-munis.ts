// ============================================================
// M2-5b / SD-32・CL-28 / D135: 住所正規化の対象自治体（代表点カバレッジ）固定辞書。
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
//     対象の増減が起きたときは両方を同時に更新する（片側だけ直すと突合が静かに壊れる・O38）。
//     突合（match_address_to_geo_point）は g.muni_code_5 = p_muni_code_5 の対称結合で、
//     正規化器が返す muniCode5 と geo_reference_points の muni_code_5 が同体系でないと
//     静かに 0 件一致になる。
//
//   D135（2026-08-23 追加・9/1 商圏カバレッジ拡張）:
//     - 既存8（豊橋/岡崎/刈谷/豊田/安城/知立/高浜/鹿児島）に加え、愛知の6市
//       （瀬戸/西尾/尾張旭/岩倉/北名古屋/長久手）を追加。
//     - 名古屋市は【案A＝行政区コード粒度】で追加（16区 23101〜23116・muni_code_5=区コード）。
//       ISJ 位置参照情報は政令市を行政区単位で分割（市区町村名=「名古屋市○区」/
//       town コード=区コード）するため、市コード 23100 へ丸めず ISJ を忠実格納する。
//       municipalities は 23100 と 16区の両方を保持し、ダッシュボードも政令市を
//       区の city_code でドリルインするため、区粒度は既存パラダイムと整合する。
//       ※ 区→市（23100）の丸めが要る 9月機能（名古屋校区表示・町域ランク）は、
//         結合時に municipalities 経由で吸収する方針（本辞書では丸めない・残件）。
//     - 東郷町（愛知郡東郷町 23302）は郡名の有無で表記が割れるため、
//       「東郷町」「愛知郡東郷町」の両表記を登録して吸収する（normalizeAddress は
//        郡名を除去しないため、郡付き住所は郡付き名でしか先頭一致しない）。
//     実測（2026-08-23・本番 municipalities）: 名古屋市=23100・16区=23101〜23116、
//     瀬戸23204/西尾23213/尾張旭23226/岩倉23228/北名古屋23234/長久手23238/東郷町23302。
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

// 代表点カバレッジ対象。ETL の TARGET_MUNIS と同順・同値（O38: 片側だけ直さない）。
export const TARGET_MUNICIPALITIES: ReadonlyArray<TargetMunicipality> = [
  // ── 既存8（M2-5a/5b）───────────────────────────────────────────────
  { muniCode5: '23201', prefCode: '23', prefName: '愛知県', muniName: '豊橋市' },
  { muniCode5: '23202', prefCode: '23', prefName: '愛知県', muniName: '岡崎市' },
  { muniCode5: '23210', prefCode: '23', prefName: '愛知県', muniName: '刈谷市' },
  { muniCode5: '23211', prefCode: '23', prefName: '愛知県', muniName: '豊田市' },
  { muniCode5: '23212', prefCode: '23', prefName: '愛知県', muniName: '安城市' },
  { muniCode5: '23225', prefCode: '23', prefName: '愛知県', muniName: '知立市' },
  { muniCode5: '23227', prefCode: '23', prefName: '愛知県', muniName: '高浜市' },
  { muniCode5: '46201', prefCode: '46', prefName: '鹿児島県', muniName: '鹿児島市' },
  // ── D135 追加: 愛知6市 ─────────────────────────────────────────────
  { muniCode5: '23204', prefCode: '23', prefName: '愛知県', muniName: '瀬戸市' },
  { muniCode5: '23213', prefCode: '23', prefName: '愛知県', muniName: '西尾市' },
  { muniCode5: '23226', prefCode: '23', prefName: '愛知県', muniName: '尾張旭市' },
  { muniCode5: '23228', prefCode: '23', prefName: '愛知県', muniName: '岩倉市' },
  { muniCode5: '23234', prefCode: '23', prefName: '愛知県', muniName: '北名古屋市' },
  { muniCode5: '23238', prefCode: '23', prefName: '愛知県', muniName: '長久手市' },
  // ── D135 追加: 名古屋市16区（案A・muni_code_5=行政区コード・ISJ 忠実格納）──
  { muniCode5: '23101', prefCode: '23', prefName: '愛知県', muniName: '名古屋市千種区' },
  { muniCode5: '23102', prefCode: '23', prefName: '愛知県', muniName: '名古屋市東区' },
  { muniCode5: '23103', prefCode: '23', prefName: '愛知県', muniName: '名古屋市北区' },
  { muniCode5: '23104', prefCode: '23', prefName: '愛知県', muniName: '名古屋市西区' },
  { muniCode5: '23105', prefCode: '23', prefName: '愛知県', muniName: '名古屋市中村区' },
  { muniCode5: '23106', prefCode: '23', prefName: '愛知県', muniName: '名古屋市中区' },
  { muniCode5: '23107', prefCode: '23', prefName: '愛知県', muniName: '名古屋市昭和区' },
  { muniCode5: '23108', prefCode: '23', prefName: '愛知県', muniName: '名古屋市瑞穂区' },
  { muniCode5: '23109', prefCode: '23', prefName: '愛知県', muniName: '名古屋市熱田区' },
  { muniCode5: '23110', prefCode: '23', prefName: '愛知県', muniName: '名古屋市中川区' },
  { muniCode5: '23111', prefCode: '23', prefName: '愛知県', muniName: '名古屋市港区' },
  { muniCode5: '23112', prefCode: '23', prefName: '愛知県', muniName: '名古屋市南区' },
  { muniCode5: '23113', prefCode: '23', prefName: '愛知県', muniName: '名古屋市守山区' },
  { muniCode5: '23114', prefCode: '23', prefName: '愛知県', muniName: '名古屋市緑区' },
  { muniCode5: '23115', prefCode: '23', prefName: '愛知県', muniName: '名古屋市名東区' },
  { muniCode5: '23116', prefCode: '23', prefName: '愛知県', muniName: '名古屋市天白区' },
  // ── D135 追加: 東郷町（郡名の有無で表記が割れるため両表記を登録して吸収）──
  { muniCode5: '23302', prefCode: '23', prefName: '愛知県', muniName: '愛知郡東郷町' },
  { muniCode5: '23302', prefCode: '23', prefName: '愛知県', muniName: '東郷町' },
  // ── D140（2026-08-24）豊川・日進 追加（代表点のみ。学校区は対象外）──
  { muniCode5: '23207', prefCode: '23', prefName: '愛知県', muniName: '豊川市' },
  { muniCode5: '23230', prefCode: '23', prefName: '愛知県', muniName: '日進市' },
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

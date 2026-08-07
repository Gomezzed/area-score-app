// ============================================================
// 「自治体ごとの最新 as_of」の行だけを残す純ロジック（React/DB 非依存）。
//
//   ⚠ 背景（レビュー指摘・本番実測）:
//     town_monthly_metrics の最新 as_of は自治体ごとにバラバラ
//     （刈谷=2026-07 / 岡崎=2026-06 / 姫路=2026-03 …）。
//     グローバル最大月で絞ると遅れている自治体の町域が 0 件になり、主用途が全滅する。
//     → 自治体単位で max(as_of) を求め、その月の行のみを残す。
//
//   DB 側ビュー(customer_list_town_latest)が同じ抽出を行うが、本関数を
//   アプリ層でも通すことで「最新月選定」を DB 非依存に単体テスト可能にし、
//   グローバル最大月方式への退行を検知できるようにする（冪等・二重防御）。
// ============================================================

// rows のうち、各 municipality の最大 as_of と一致する行だけを返す。
//   as_of は 'YYYY-MM-DD' 形式の文字列で辞書順比較＝日付順比較が成立する。
export function latestPerMunicipality<T>(
  rows: T[],
  getMuni: (r: T) => string,
  getAsOf: (r: T) => string,
): T[] {
  const maxByMuni = new Map<string, string>()
  for (const r of rows) {
    const muni = getMuni(r)
    const asOf = getAsOf(r)
    const cur = maxByMuni.get(muni)
    if (cur == null || asOf > cur) maxByMuni.set(muni, asOf)
  }
  return rows.filter((r) => getAsOf(r) === maxByMuni.get(getMuni(r)))
}

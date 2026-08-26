// 取込エリア一覧 API（SD-44）の school_type バリデーション（純ロジック）。
//   ★node --test は @/ エイリアスや next/server を解決できないため、route.ts の
//     入力検証のうち純粋な部分だけをこの相対 import で完結する純モジュールに切り出し、
//     単体テスト可能にする（唯一の利用者は同ディレクトリの route.ts）。
//   allowlist は school-district-ranking と同じ 2 値（'elementary' / 'junior_high'）。
export const AREAS_SCHOOL_TYPES = ['elementary', 'junior_high'] as const
export type AreasSchoolType = (typeof AREAS_SCHOOL_TYPES)[number]

// 未指定(null)は既定 'elementary'。allowlist 外は null（呼び出し側で 400 に丸める）。
export function parseAreasSchoolType(raw: string | null): AreasSchoolType | null {
  const v = raw ?? 'elementary'
  return v === 'elementary' || v === 'junior_high' ? v : null
}

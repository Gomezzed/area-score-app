// ============================================================
// 自社顧客リスト連携（D24 STEP1）— 共有型定義
//   React 非依存。突合エンジン / API / UI が共通で参照する。
// ============================================================

// 突合の3値判定（原則1/5: 推測での一致を残さない）。
//   confirmed    … 町域が一意に確定
//   ambiguous    … 候補が複数で一意に定まらない → match_candidates に保持
//                  ・市区町村レベル: 都道府県省略で同名の市が複数（例: 府中市）
//                  ・町域レベル    : 同名異町域（office_name 違い）
//   out_of_scope … 町域データ未整備 or 市区町村を特定できず（＝参考値扱い）
export type MatchStatus = 'confirmed' | 'ambiguous' | 'out_of_scope'

// 町域マスタの1件（DBの town_monthly_metrics から供給される最小情報）。
//   突合エンジンはこの配列（TownIndex）だけを見て判定する純ロジック。
export interface TownRecord {
  municipality_id: string
  municipality_name: string // 例: '岡崎市'
  town_id: number
  town_name: string // 正規化前の正データ町名（例: '稲熊町'）
  town_name_raw: string | null // 原表記（参考）
  office_name: string | null // 出張所/支所（同名異町域の一意化・原則3）
}

// 突合の候補（ambiguous 時に match_candidates jsonb へ保存する形）。
//   2階層の ambiguous を1つの型で表す:
//     - 市区町村レベル（府中市問題）: municipality_name / prefecture_code を持ち、
//       町域は未確定なので town_* は null。
//     - 町域レベル（同名異町域）    : town_id / town_name / office_name を持つ。
export interface MatchCandidate {
  municipality_id: string
  municipality_name?: string // 市区町村レベル候補の可読名（例: '府中市'）
  prefecture_code?: string | null // 同上（どの府中市かの手がかり）
  town_id: number | null // 町域レベル候補のみ実値。市区町村レベルでは null
  town_name: string | null
  office_name: string | null
}

// 突合1行の結果。
export interface MatchResult {
  status: MatchStatus
  municipality_id: string | null
  // confirmed 時の一意町域名（正規化後）。ambiguous/out_of_scope では null。
  town_name_normalized: string | null
  // ambiguous 時の候補一覧（confirmed/out_of_scope では空配列）。
  candidates: MatchCandidate[]
  // 正規化後の住所（DB の address_normalized に保存）。
  address_normalized: string
}

// CSV の論理列（内部キー）。電話は取り込むが保存しない（category に含めない）。
export type CustomerColumnKey =
  | 'inquiry_at' // 反響日時
  | 'customer_name' // 顧客名
  | 'media' // 反響媒体
  | 'address' // 住所
  | 'phone' // 電話（取り込むが保存しない）
  | 'last_contact_at' // 最終接触日
  | 'category' // 種別
  | 'assignee' // 担当

// CSVヘッダ → 論理列 の対応（列インデックスで保持）。
export type ColumnMapping = Partial<Record<CustomerColumnKey, number>>

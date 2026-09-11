// ============================================================
// PR-BM-7: 売主向けシートが扱う型。BM-5 の GET 3ルートのうち
//   summary / cells の2本にだけ対応する（⛔ rows＝個票は売主向けから呼ばない）。
//   ⚠ 外部 import を持たない（node --test で直接読める純モジュール）。
// ============================================================

// GET /api/customer-lists/[id]/buyer-match/summary の jsonb（裁定24 で透過）。
//   ⛔ unknown_area_count は意図的に宣言しない。k 抑止の対象外の生値であり、
//     売主向けの画面・PDF に出してはならない（BM-4 裁定17）。型に無ければ
//     参照した時点で型エラーになる＝構造的な誤表示の防止。
//   ⚠ wide_count / near_count は抑止時に null ではなく 0 が返る（RPC の
//     CASE WHEN n >= k THEN n ELSE 0 END）。したがって「0 かどうか」ではなく
//     必ず suppressed_* で判定する（display.ts の責務）。
export interface BuyerMatchSummary {
  wide_count: number
  near_count: number
  suppressed_wide: boolean
  suppressed_near: boolean
  k: number
}

// GET /api/customer-lists/[id]/buyer-match/cells の rows 1件（RPC の返り列そのまま）。
//   price_bucket_* は半開区間 [min, max) の万円。両方 null は「価格の希望なし」枠。
//   floor_area_bucket_* は [min, min+20) の㎡。両方 null は「広さの希望なし」枠。
//   ⛔ n を合算して総数にしてはならない（1行が複数の価格バケットに現れる）。
//     総数が要るときは summary の wide_count / near_count を使う。
export interface BuyerMatchCell {
  property_type: string
  label_ja: string
  price_bucket_min: number | null
  price_bucket_max: number | null
  floor_area_bucket_min: number | null
  floor_area_bucket_max: number | null
  n: number
}

// 物件種別セレクトの選択肢（public.property_types・裁定35）。
//   ⛔ 6値のラベルをクライアントに直書きしない（原則19）。DB が唯一の定義。
export interface PropertyTypeOption {
  code: string
  label_ja: string
}

// 売主が入力する物件条件。school_district_id は持たない（裁定33・案A）。
export interface SellerCondition {
  muniCode5: string | null
  muniName: string | null
  propertyType: string | null
  propertyTypeLabel: string | null
  priceMin: number | null
  priceMax: number | null
}

// ============================================================
// PR-BM-9b-1: GET /api/customer-lists/[id]/buyer-match/cards が透過する匿名カード（裁定61）。
//   RPC get_buyer_match_cards が返す単一 jsonb をそのまま表す（裁定60/66 で無改変透過）。
//   ⛔ 禁止16列（row_id / list_id / user_id / organization_id / external_id /
//     customer_name / assignee / inquiry_at / media / category / address_raw /
//     address_normalized / desired_school / input_name / normalized_name /
//     match_method / candidate_count）は宣言しない。宣言しなければ参照した時点で型エラーに
//     なり、匿名カードへ実在属性が混入するのを構造的に防ぐ（BM-7 で unknown_area_count を
//     宣言しなかったのと同じ手法・裁定61）。
// ============================================================

// 匿名カード1枚。キーは8つのみ（PM 確定・これ以外を足さない）。
//   1枚＝1人の粒度の匿名化済み希望条件（属性の絞り込みは RPC 側で完結・API は加工しない）。
export interface BuyerMatchCard {
  property_types: string[]
  price_min: number | null
  price_max: number | null
  desired_floor_area_min: number | null
  desired_floor_area_max: number | null
  desired_land_area_min: number | null
  desired_land_area_max: number | null
  desired_districts: string[]
}

// cards ルートが透過する jsonb 全体（裁定60/66・summary と同型で data ?? {} を返す）。
//   stage は 1〜4 または null。used_conditions は付随オブジェクトまたは null。
//   cards は 0〜max_cards(=6) 枚。suppressed は k 匿名化で抑止されたか。
export interface BuyerMatchCards {
  opt_in: boolean
  k: number
  max_cards: number
  stage: number | null
  used_conditions: Record<string, unknown> | null
  matched_count: number
  suppressed: boolean
  cards: BuyerMatchCard[]
}

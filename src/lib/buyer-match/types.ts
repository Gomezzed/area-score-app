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

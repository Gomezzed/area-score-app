// =====================================================================
// 校区ヒートマップ地図の塗り分けスタイル（純ロジック）。
//   TIER_LABEL（school-district-tiers.ts）と対になる。片方だけ変更しない。
//   ラベル（非常に多い/多い/やや多い/少ない）と塗り色（TIER_FILL）は同じ tier 番号で
//   一対一に対応する。ラベルを増減・改称したらこちらの色も必ず合わせる。
//
//   ⛔ 新しい色系統を持ち込まない。表側の TIER_CHIP と同じ rose/amber/brand/slate 系統の
//     濃いめ（地図の塗りとして視認できる濃さ）を使う。
//     - brand-500 は globals.css の @theme トークン(--color-brand-500=#2e5480)。
// =====================================================================

// tier 4/3/2/1 の塗り色（TIER_CHIP と同系統・地図で視認できる濃さ）。
export const TIER_FILL: Record<number, string> = {
  4: '#f43f5e', // rose-500（表: rose 系）
  3: '#f59e0b', // amber-500（表: amber 系）
  2: '#2e5480', // brand-500（表: brand 系・globals.css @theme）
  1: '#94a3b8', // slate-400（表: slate 系）
}

// 濃淡データが無い校区（tier=null/undefined）の塗り色。tier=1(slate-400)より薄い slate-300。
export const NO_DATA_FILL = '#cbd5e1' // slate-300

// Leaflet の path option（style コールバックの返り値）に渡す純データ。
export interface TierPathStyle {
  color: string // 境界線の色
  weight: number // 境界線の太さ
  fillColor: string // 塗り色
  fillOpacity: number // 塗りの不透明度
  dashArray?: string // 破線パターン（データ無しのときだけ設定）
}

// tier → Leaflet path style を返す純関数。
//   - tier が 1〜4：TIER_FILL の色・視認できる fillOpacity・境界線は【実線】(dashArray なし)。
//   - tier が null/undefined（濃淡データが無い校区。k=5 抑止・該当反響なしを含む）：
//     薄いグレー・低い fillOpacity・境界線は【破線】。
//     ⛔ tier=1（slate 系）と色だけでは見分けられないため、破線で必ず差をつける（必須要件）。
export function tierToPathStyle(tier: number | null | undefined): TierPathStyle {
  if (tier != null && TIER_FILL[tier] !== undefined) {
    return {
      color: '#475569', // slate-600（実線の境界）
      weight: 1,
      fillColor: TIER_FILL[tier],
      fillOpacity: 0.6,
      // dashArray なし＝実線
    }
  }
  // データ無し：薄いグレー＋破線。tier=1 と等しくならないようにする。
  return {
    color: '#94a3b8', // slate-400
    weight: 1,
    fillColor: NO_DATA_FILL,
    fillOpacity: 0.25,
    dashArray: '4 4', // 破線
  }
}

// =====================================================================
// 校区ヒートマップ PDF の用紙・フレーム幾何（純ロジック・依存ゼロ）。
//   A4横・mm→pt 換算・ヘッダ/フレーム/フッタ矩形・出力倍率(px/pt)を定義する。
//   ⚠ 外部 import を持たない（テストは node --test で相対 import・@/ 不使用）。
//   数値の出所は docs/specs/heatmap_pdf_export_v1.md §4。
// =====================================================================

export const MM_PER_INCH = 25.4
export const PT_PER_INCH = 72

// mm → pt。1 inch = 25.4mm = 72pt。
export function mmToPt(mm: number): number {
  return (mm * PT_PER_INCH) / MM_PER_INCH
}

// A4 横向き（pt）。
export const A4_LANDSCAPE_PT = { width: 841.89, height: 595.28 } as const

// 余白・帯・フレーム（mm）。
export const PAGE_MARGIN_MM = 10
export const HEADER_BAND_MM = 12
export const FRAME_MM = { width: 277, height: 150 } as const
export const FRAME_TOP_MM = 24

// 出力倍率（pt あたりのラスタ px）。3 px/pt = 216dpi。
export const PDF_PX_PER_PT = 3

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface PxSize {
  width: number
  height: number
}

// ヘッダ帯（pt）。用紙左上・上余白の内側。
export function headerRectPt(): Rect {
  return {
    x: mmToPt(PAGE_MARGIN_MM),
    y: mmToPt(PAGE_MARGIN_MM),
    width: mmToPt(FRAME_MM.width),
    height: mmToPt(HEADER_BAND_MM),
  }
}

// 地図フレーム（pt）。上端 y=24mm・幅 277mm・高さ 150mm。
export function frameRectPt(): Rect {
  return {
    x: mmToPt(PAGE_MARGIN_MM),
    y: mmToPt(FRAME_TOP_MM),
    width: mmToPt(FRAME_MM.width),
    height: mmToPt(FRAME_MM.height),
  }
}

// フッタ帯（pt）。フレーム下端から下余白まで。
export function footerRectPt(): Rect {
  const frame = frameRectPt()
  const top = frame.y + frame.height
  const bottom = A4_LANDSCAPE_PT.height - mmToPt(PAGE_MARGIN_MM)
  return {
    x: mmToPt(PAGE_MARGIN_MM),
    y: top,
    width: mmToPt(FRAME_MM.width),
    height: bottom - top,
  }
}

// フレームのラスタ px サイズ（整数化）。倍率 3 px/pt。
export function framePx(): PxSize {
  const frame = frameRectPt()
  return {
    width: Math.round(frame.width * PDF_PX_PER_PT),
    height: Math.round(frame.height * PDF_PX_PER_PT),
  }
}

// =====================================================================
// 2パネル（小学校区＋中学校区）用の幾何（追加のみ・PR-C）。
//   地図フレーム領域（FRAME_MM＝277×150mm）を左右2分割・間隔 PANEL_GAP_MM。
//   各パネル幅は等分。左＝小学校区・右＝中学校区で固定（呼び出し側で割当）。
//   高さはフレームと同じ（150mm）。既存の frameRectPt / framePx は不変。
// =====================================================================

// 左右パネルの間隔（mm）。
export const PANEL_GAP_MM = 4

// 各パネルの幅（mm・等分）。(277 - 4) / 2 = 136.5mm。
export function panelWidthMm(): number {
  return (FRAME_MM.width - PANEL_GAP_MM) / 2
}

// 左右パネルの矩形（pt）。フレームと同じ領域を間隔で二分する。
//   left.x = frame.x、right.x = frame.x + 幅 + 間隔。両パネル同じ y・幅・高さ。
export function panelRectsPt(): { left: Rect; right: Rect } {
  const frame = frameRectPt()
  const gap = mmToPt(PANEL_GAP_MM)
  const width = (frame.width - gap) / 2
  return {
    left: { x: frame.x, y: frame.y, width, height: frame.height },
    right: { x: frame.x + width + gap, y: frame.y, width, height: frame.height },
  }
}

// 各パネルのラスタ px サイズ（両パネル等分＝同値）。倍率 3 px/pt。
//   ⚠ このサイズを render.ts の framePx 引数に渡すと、ズーム・タイル範囲・膜が
//     パネル px を基準に計算される（両パネル同値のズームになる）。
export function panelFramePx(): PxSize {
  const { left } = panelRectsPt()
  return {
    width: Math.round(left.width * PDF_PX_PER_PT),
    height: Math.round(left.height * PDF_PX_PER_PT),
  }
}

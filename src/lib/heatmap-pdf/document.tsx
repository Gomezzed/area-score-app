// =====================================================================
// 校区ヒートマップ PDF の Document（@react-pdf/renderer）。
//   ヘッダ（タイトル＋出力日時）／地図フレーム画像／凡例／フッタ（出典・免責・
//   OSM 帰属・サイト表記）＋メタデータ。
//   ⛔ src/lib/pdf.tsx は変更しない（S-3）。フォントは同じ family・同じ src で
//     このモジュール単独で登録する（S-13：別 family を重ねない）。
//   ⛔ tier 以外の値（件数・氏名・住所・座標点）を描かない（S-4）。
// =====================================================================

import { createElement } from 'react'
import {
  Document,
  Page,
  View,
  Text,
  Font,
  StyleSheet,
  Image as PdfImage,
} from '@react-pdf/renderer'
import { A4_LANDSCAPE_PT, frameRectPt, headerRectPt, footerRectPt, panelRectsPt } from './geometry.ts'
import type { LegendRow, HeatmapPdfBothModel } from './model.ts'

// 日本語フォント（pdf.tsx:30 と同じ値。別 family を重ねない）。
Font.register({ family: 'NotoSansJP', src: '/fonts/NotoSansJP-Regular.woff' })
Font.registerHyphenationCallback((word) => [word])

const frame = frameRectPt()
const header = headerRectPt()
const footer = footerRectPt()
// 2パネル（PR-C）：左右枠。左＝小学校区・右＝中学校区（呼び出し側で割当）。
const panels = panelRectsPt()

const styles = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansJP',
    fontSize: 8,
    color: '#0f172a',
    backgroundColor: '#ffffff',
  },
  header: {
    position: 'absolute',
    left: header.x,
    top: header.y,
    width: header.width,
  },
  title: { fontFamily: 'NotoSansJP', fontSize: 13, color: '#1e3f66' },
  generatedAt: { fontFamily: 'NotoSansJP', fontSize: 8, color: '#64748b', marginTop: 3 },
  frame: {
    position: 'absolute',
    left: frame.x,
    top: frame.y,
    width: frame.width,
    height: frame.height,
    borderWidth: 0.75,
    borderColor: '#94a3b8',
  },
  frameImage: { width: '100%', height: '100%', objectFit: 'cover' },
  footer: {
    position: 'absolute',
    left: footer.x,
    top: footer.y,
    width: footer.width,
  },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 12, marginBottom: 2 },
  legendSwatch: { width: 12, height: 9, borderRadius: 1, borderWidth: 0.5, borderColor: '#475569', marginRight: 4 },
  legendLabel: { fontFamily: 'NotoSansJP', fontSize: 7.5, color: '#334155' },
  attribution: { fontFamily: 'NotoSansJP', fontSize: 7.5, color: '#64748b', marginTop: 2 },
  disclaimer: { fontFamily: 'NotoSansJP', fontSize: 7, color: '#94a3b8', marginTop: 3, lineHeight: 1.35 },
  credit: { fontFamily: 'NotoSansJP', fontSize: 7, color: '#94a3b8', marginTop: 2 },
  warning: { fontFamily: 'NotoSansJP', fontSize: 7.5, color: '#b45309', marginTop: 3 },
  // 2パネル（PR-C）：各枠は絶対配置（x/width は panels から個別注入）。
  panelFrame: {
    position: 'absolute',
    top: panels.left.y,
    height: panels.left.height,
    borderWidth: 0.75,
    borderColor: '#94a3b8',
  },
  panelImage: { width: '100%', height: '100%', objectFit: 'cover' },
  // 見出し（校区種別ラベル）を枠左上に薄い下地で重ねる。
  panelHeading: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 2,
    paddingLeft: 4,
    paddingRight: 4,
    paddingTop: 1,
    paddingBottom: 1,
  },
  panelHeadingText: { fontFamily: 'NotoSansJP', fontSize: 8.5, color: '#1e3f66' },
})

export interface HeatmapPdfDocProps {
  metaTitle: string
  title: string
  generatedAtLabel: string
  pngDataUrl: string
  legend: LegendRow[]
  attributions: string[]
  disclaimer: string
  osmAttribution: string
  siteLabel: string
  tilesFailed: boolean
}

function LegendSwatch({ row }: { row: LegendRow }) {
  return (
    <View
      style={[
        styles.legendSwatch,
        { backgroundColor: row.color, opacity: row.opacity },
        row.dashed ? { borderStyle: 'dashed', borderColor: '#94a3b8' } : {},
      ]}
    />
  )
}

export function HeatmapPdfDocument(props: HeatmapPdfDocProps) {
  return createElement(
    Document,
    { title: props.metaTitle, author: 'エリアスコア' },
    createElement(
      Page,
      { size: 'A4', orientation: 'landscape', style: styles.page },
      // ── ヘッダ ──
      createElement(
        View,
        { style: styles.header },
        createElement(Text, { style: styles.title }, props.title),
        createElement(Text, { style: styles.generatedAt }, `出力日時: ${props.generatedAtLabel}`),
      ),
      // ── 地図フレーム（合成 PNG）──
      createElement(
        View,
        { style: styles.frame },
        createElement(PdfImage, { src: props.pngDataUrl, style: styles.frameImage }),
      ),
      // ── フッタ（凡例・出典・免責・帰属）──
      createElement(
        View,
        { style: styles.footer },
        createElement(
          View,
          { style: styles.legendRow },
          ...props.legend.map((row, i) =>
            createElement(
              View,
              { key: `lg-${i}`, style: styles.legendItem },
              createElement(LegendSwatch, { row }),
              createElement(Text, { style: styles.legendLabel }, row.label),
            ),
          ),
        ),
        props.tilesFailed
          ? createElement(Text, { style: styles.warning }, '一部の地図タイルを取得できませんでした')
          : null,
        ...props.attributions.map((a, i) =>
          createElement(Text, { key: `at-${i}`, style: styles.attribution }, a),
        ),
        createElement(Text, { style: styles.disclaimer }, props.disclaimer),
        createElement(
          Text,
          { style: styles.credit },
          `地図: ${props.osmAttribution}　・　${props.siteLabel}`,
        ),
      ),
    ),
  )
}

// =====================================================================
// 2パネル（小学校区＋中学校区）Document（PR-C・追加のみ）。
//   既存 HeatmapPdfDocument は不変。ヘッダ／左右2枠（各見出し付き）／共通凡例1つ／
//   フッタ（出典2系列＝小→中・免責・OSM 帰属・サイト表記）＋メタデータ。
//   ⛔ フォント登録・pdf.tsx は不変（S-3/S-13）。tier 以外の値を描かない（S-4）。
// =====================================================================

// 片方のパネル（枠＋合成 PNG＋見出し）。x/width は panels から注入。
function BothPanel({
  rect,
  heading,
  pngDataUrl,
}: {
  rect: { x: number; width: number }
  heading: string
  pngDataUrl: string
}) {
  return createElement(
    View,
    { style: [styles.panelFrame, { left: rect.x, width: rect.width }] },
    createElement(PdfImage, { src: pngDataUrl, style: styles.panelImage }),
    createElement(
      View,
      { style: styles.panelHeading },
      createElement(Text, { style: styles.panelHeadingText }, heading),
    ),
  )
}

export function HeatmapPdfDocumentBoth(props: HeatmapPdfBothModel) {
  const anyTilesFailed = props.left.tilesFailed || props.right.tilesFailed
  return createElement(
    Document,
    { title: props.metaTitle, author: 'エリアスコア' },
    createElement(
      Page,
      { size: 'A4', orientation: 'landscape', style: styles.page },
      // ── ヘッダ ──
      createElement(
        View,
        { style: styles.header },
        createElement(Text, { style: styles.title }, props.title),
        createElement(Text, { style: styles.generatedAt }, `出力日時: ${props.generatedAtLabel}`),
      ),
      // ── 左パネル（小学校区）──
      createElement(BothPanel, {
        rect: panels.left,
        heading: props.left.heading,
        pngDataUrl: props.left.pngDataUrl,
      }),
      // ── 右パネル（中学校区）──
      createElement(BothPanel, {
        rect: panels.right,
        heading: props.right.heading,
        pngDataUrl: props.right.pngDataUrl,
      }),
      // ── フッタ（共通凡例1つ・出典2系列・免責・帰属）──
      createElement(
        View,
        { style: styles.footer },
        createElement(
          View,
          { style: styles.legendRow },
          ...props.legend.map((row, i) =>
            createElement(
              View,
              { key: `lg-${i}`, style: styles.legendItem },
              createElement(LegendSwatch, { row }),
              createElement(Text, { style: styles.legendLabel }, row.label),
            ),
          ),
        ),
        anyTilesFailed
          ? createElement(Text, { style: styles.warning }, '一部の地図タイルを取得できませんでした')
          : null,
        ...props.attributions.map((a, i) =>
          createElement(Text, { key: `at-${i}`, style: styles.attribution }, a),
        ),
        createElement(Text, { style: styles.disclaimer }, props.disclaimer),
        createElement(
          Text,
          { style: styles.credit },
          `地図: ${props.osmAttribution}　・　${props.siteLabel}`,
        ),
      ),
    ),
  )
}

// 幅（pt）を外部から参照する用途はないが、レイアウト定数の単体確認のため公開。
export const PAGE_SIZE_PT = A4_LANDSCAPE_PT

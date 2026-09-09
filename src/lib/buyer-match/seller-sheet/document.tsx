'use client'

// =====================================================================
// PR-BM-7: 売主向けシート PDF（A4横2枚・裁定31/39）。
//   1枚目 … ヘッダ（ロゴ・物件条件）／大きな数字2つ／学区図パネル／出典／免責
//   2枚目 … 内訳カード（最大6セル・2行3列）／出典／免責
//   ⛔ 個票を出さない。⛔ unknown_area_count を出さない。
//   ⛔ k=5 未満のとき数値を出さない（判定は display.ts の buildCountDisplays が
//     済ませており、ここは value === null なら代替文言を出すだけ）。
//   ⛔ セルの n を合算して総数として出さない。
//   ⛔ src/lib/heatmap-pdf は変更しない（裁定39）。用紙幾何は geometry.ts の
//     A4_LANDSCAPE_PT / frameRectPt / mmToPt を流用する。
//   ⚠ フォントは pdf.tsx:30・heatmap-pdf/document.tsx:24 と同じ family・同じ src で
//     このモジュール単独で登録する（別 family を重ねない）。
//   ※ @react-pdf/renderer は重く SSR 不可のため、呼び出し側で動的 import すること。
// =====================================================================

import {
  Document,
  Page,
  View,
  Text,
  Font,
  StyleSheet,
  Image as PdfImage,
} from '@react-pdf/renderer'
import { A4_LANDSCAPE_PT, frameRectPt, mmToPt } from '@/lib/heatmap-pdf/geometry'
import type { LegendRow } from '@/lib/heatmap-pdf/model'
import { BUYER_MATCH_MESSAGES } from '@/lib/buyer-match/messages'
import { formatCellCount, formatCellTitle, formatCountValue } from '@/lib/buyer-match/display'
import type { CountDisplays } from '@/lib/buyer-match/display'
import type { BuyerMatchCell } from '@/lib/buyer-match/types'

Font.register({ family: 'NotoSansJP', src: '/fonts/NotoSansJP-Regular.woff' })
Font.registerHyphenationCallback((word) => [word])

// 自社マーク。⛔ 顧客ロゴの取得経路（P1-5）は本 PR で作らない。
export const DEFAULT_LOGO_SRC = '/brand/areascore-mark.png'

const frame = frameRectPt()
const MARGIN = mmToPt(10)
// 学区図の表示寸法。合成 PNG は frameRectPt() と同じ比率（277:150）なので、
//   縦を 112mm に収める倍率で相似縮小する（cover で切り取らない）。
const MAP_SCALE = mmToPt(112) / frame.height
const MAP_WIDTH = frame.width * MAP_SCALE
const MAP_HEIGHT = frame.height * MAP_SCALE
// 内訳カードは 3 列（2行3列＝最大6セル）。
const CELL_GAP = mmToPt(4)
const CELL_WIDTH = (frame.width - CELL_GAP * 2) / 3

const styles = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansJP',
    fontSize: 9,
    color: '#0f172a',
    backgroundColor: '#ffffff',
    paddingTop: MARGIN,
    paddingBottom: MARGIN,
    paddingHorizontal: MARGIN,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderBottomWidth: 1.5,
    borderBottomColor: '#1e3f66',
    paddingBottom: 6,
    marginBottom: 8,
  },
  logo: { width: 26, height: 26, marginRight: 8 },
  headerText: { flexGrow: 1 },
  title: { fontFamily: 'NotoSansJP', fontSize: 14, color: '#1e3f66' },
  conditionLine: { fontFamily: 'NotoSansJP', fontSize: 9, color: '#334155', marginTop: 2 },
  generatedAt: { fontFamily: 'NotoSansJP', fontSize: 7.5, color: '#64748b', marginTop: 2 },

  countRow: { flexDirection: 'row', marginBottom: 8 },
  countCard: {
    flexGrow: 1,
    flexBasis: 0,
    borderWidth: 0.75,
    borderColor: '#cbd5e1',
    borderRadius: 3,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  countCardGap: { marginRight: CELL_GAP },
  countHeading: { fontFamily: 'NotoSansJP', fontSize: 8.5, color: '#475569' },
  countValue: { fontFamily: 'NotoSansJP', fontSize: 22, color: '#0f172a', marginTop: 2 },
  countMessage: { fontFamily: 'NotoSansJP', fontSize: 9, color: '#64748b', marginTop: 4, lineHeight: 1.4 },

  mapWrap: { alignItems: 'center', marginBottom: 6 },
  mapFrame: {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    borderWidth: 0.75,
    borderColor: '#94a3b8',
  },
  mapImage: { width: '100%', height: '100%', objectFit: 'cover' },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 12, marginBottom: 2 },
  legendSwatch: {
    width: 12,
    height: 9,
    borderRadius: 1,
    borderWidth: 0.5,
    borderColor: '#475569',
    marginRight: 4,
  },
  legendLabel: { fontFamily: 'NotoSansJP', fontSize: 7.5, color: '#334155' },

  sectionHead: { fontFamily: 'NotoSansJP', fontSize: 10, color: '#1e3f66', marginBottom: 5 },
  cellGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  cellCard: {
    width: CELL_WIDTH,
    marginRight: CELL_GAP,
    marginBottom: CELL_GAP,
    borderWidth: 0.75,
    borderColor: '#cbd5e1',
    borderRadius: 3,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  cellCardLast: { marginRight: 0 },
  cellTitle: { fontFamily: 'NotoSansJP', fontSize: 8, color: '#475569', lineHeight: 1.35 },
  cellCount: { fontFamily: 'NotoSansJP', fontSize: 15, color: '#0f172a', marginTop: 3 },
  overflowCard: {
    width: CELL_WIDTH,
    marginBottom: CELL_GAP,
    borderWidth: 0.75,
    borderColor: '#cbd5e1',
    borderStyle: 'dashed',
    borderRadius: 3,
    paddingVertical: 6,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  overflowText: { fontFamily: 'NotoSansJP', fontSize: 10, color: '#94a3b8', textAlign: 'center' },
  emptyNote: { fontFamily: 'NotoSansJP', fontSize: 9, color: '#64748b', lineHeight: 1.4 },

  footer: { marginTop: 'auto' },
  attribution: { fontFamily: 'NotoSansJP', fontSize: 7.5, color: '#64748b', marginTop: 2 },
  disclaimer: { fontFamily: 'NotoSansJP', fontSize: 7, color: '#94a3b8', marginTop: 3, lineHeight: 1.35 },
  warning: { fontFamily: 'NotoSansJP', fontSize: 7.5, color: '#b45309', marginTop: 3 },
})

export interface SellerSheetDocProps {
  // PDF メタデータ title 兼 見出し。
  title: string
  // ヘッダに出す物件条件の行（売主の入力値のみ）。
  conditionLines: string[]
  generatedAtLabel: string
  // 大きな数字2つ。suppressed のとき value は null（display.ts が保証）。
  counts: CountDisplays
  // 内訳カード（最大6セル・n 降順）。空配列なら emptyMessage を出す。
  cells: BuyerMatchCell[]
  cellsEmptyMessage: string | null
  // 7件目以降の 'ほか'。⛔ 残り件数は渡らない。
  overflowLabel: string | null
  // 学区図パネル（合成 PNG）。未取得なら null＝パネルごと出さない。
  mapPngDataUrl: string | null
  mapTilesFailed: boolean
  legend: LegendRow[]
  // 出典（attribution_text をそのまま・1行ずつ印字）。
  attributions: string[]
  // 学区図の免責（SCHOOL_DISTRICT_DISCLAIMER）。学区図が無いときは null。
  mapDisclaimer: string | null
  // 差し替え可能なロゴ（裁定32）。省略時は自社マーク。
  //   ⚠ 顧客ロゴ経路（P1-5）が確定したら logoSrc を渡すだけで差し替わる。
  //     置き場は public/brand/partners/ の見込み。本 PR では呼び出し側が undefined を渡す。
  logoSrc?: string
}

function CountCard({
  display,
  gap,
}: {
  display: CountDisplays['wide']
  gap: boolean
}) {
  return (
    <View style={gap ? [styles.countCard, styles.countCardGap] : styles.countCard}>
      <Text style={styles.countHeading}>{display.heading}</Text>
      {display.value === null ? (
        <Text style={styles.countMessage}>{display.message}</Text>
      ) : (
        <Text style={styles.countValue}>{formatCountValue(display.value)}</Text>
      )}
    </View>
  )
}

function Footer({
  attributions,
  mapDisclaimer,
}: {
  attributions: string[]
  mapDisclaimer: string | null
}) {
  return (
    <View style={styles.footer}>
      {attributions.map((a, i) => (
        <Text key={`at-${i}`} style={styles.attribution}>
          {a}
        </Text>
      ))}
      {mapDisclaimer && <Text style={styles.disclaimer}>{mapDisclaimer}</Text>}
      <Text style={styles.disclaimer}>{BUYER_MATCH_MESSAGES.disclaimer}</Text>
    </View>
  )
}

// Document 要素を返す（⚠ createElement/JSX で包むと DocumentProps 型が失われるため、
//   呼び出し側は <SellerSheetDocument/> ではなく SellerSheetDocument(props) と呼ぶ）。
export function SellerSheetDocument(props: SellerSheetDocProps) {
  const logo = props.logoSrc ?? DEFAULT_LOGO_SRC
  return (
    <Document title={props.title} author="エリアスコア">
      {/* ── 1枚目: ヘッダ／数字2つ／学区図／出典／免責 ── */}
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.header}>
          <PdfImage src={logo} style={styles.logo} />
          <View style={styles.headerText}>
            <Text style={styles.title}>{props.title}</Text>
            {props.conditionLines.map((line, i) => (
              <Text key={`cond-${i}`} style={styles.conditionLine}>
                {line}
              </Text>
            ))}
            <Text style={styles.generatedAt}>出力日時: {props.generatedAtLabel}</Text>
          </View>
        </View>

        <View style={styles.countRow}>
          <CountCard display={props.counts.wide} gap />
          <CountCard display={props.counts.near} gap={false} />
        </View>

        {props.mapPngDataUrl && (
          <View style={styles.mapWrap}>
            <View style={styles.mapFrame}>
              <PdfImage src={props.mapPngDataUrl} style={styles.mapImage} />
            </View>
            <View style={styles.legendRow}>
              {props.legend.map((row, i) => (
                <View key={`lg-${i}`} style={styles.legendItem}>
                  <View
                    style={[
                      styles.legendSwatch,
                      { backgroundColor: row.color, opacity: row.opacity },
                      row.dashed ? { borderStyle: 'dashed', borderColor: '#94a3b8' } : {},
                    ]}
                  />
                  <Text style={styles.legendLabel}>{row.label}</Text>
                </View>
              ))}
            </View>
            {props.mapTilesFailed && (
              <Text style={styles.warning}>一部の地図タイルを取得できませんでした</Text>
            )}
          </View>
        )}

        <Footer attributions={props.attributions} mapDisclaimer={props.mapDisclaimer} />
      </Page>

      {/* ── 2枚目: 内訳カード（最大6セル・2行3列）／出典／免責 ── */}
      {/* ⛔ 個票・unknown_area_count は出さない。⛔ n を合算しない。 */}
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>{props.title}（内訳）</Text>
            <Text style={styles.generatedAt}>出力日時: {props.generatedAtLabel}</Text>
          </View>
        </View>

        <Text style={styles.sectionHead}>内訳</Text>
        {props.cellsEmptyMessage ? (
          <Text style={styles.emptyNote}>{props.cellsEmptyMessage}</Text>
        ) : (
          <View style={styles.cellGrid}>
            {props.cells.map((c, i) => (
              <View
                key={`${c.property_type}:${c.price_bucket_min ?? 'x'}:${c.floor_area_bucket_min ?? 'x'}`}
                style={i % 3 === 2 ? [styles.cellCard, styles.cellCardLast] : styles.cellCard}
                wrap={false}
              >
                <Text style={styles.cellTitle}>{formatCellTitle(c)}</Text>
                <Text style={styles.cellCount}>{formatCellCount(c)}</Text>
              </View>
            ))}
            {/* 7件目以降。⛔ 残り件数を出さない（裁定34）。*/}
            {props.overflowLabel && (
              <View style={styles.overflowCard}>
                <Text style={styles.overflowText}>{props.overflowLabel}</Text>
              </View>
            )}
          </View>
        )}

        <Footer attributions={props.attributions} mapDisclaimer={props.mapDisclaimer} />
      </Page>
    </Document>
  )
}

// 用紙寸法の参照用（レイアウト定数の単体確認）。
export const SELLER_SHEET_PAGE_PT = A4_LANDSCAPE_PT

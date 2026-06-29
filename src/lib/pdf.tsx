'use client'

// ============================================================
// PDF-A: 選択中エリア（都道府県）の市区町村スコア一覧表をクライアント生成。
//   - csv.ts と同じデータ（MunicipalityWithStats[] + Prefecture）を受け取り、
//     同じ列（人口/世帯数/増減/駅乗降客数）を表組みで描画する。
//   - 日本語は public/fonts/NotoSansJP-Regular.woff を Font.register して埋め込む
//     （CJK 文字化け防止。全 Text に fontFamily を当てる）。
//   - gating(Starter+) は呼び出し側（dashboard）で canExportPdf により制御。
//     本モジュールは描画とダウンロードのみを担う。
//
//   ※ @react-pdf/renderer は重く SSR 不可のため、呼び出し側で動的 import すること。
//     本ファイル自体はクリック時にのみ読み込まれる前提（モジュール評価時に Font.register）。
// ============================================================

import {
  Document,
  Page,
  View,
  Text,
  Font,
  StyleSheet,
  pdf,
} from '@react-pdf/renderer'
import type { MunicipalityWithStats, Prefecture } from '@/types'
import { CENSUS } from '@/lib/census'

// 日本語フォント登録（PO確定: woff 1本）。src はブラウザ origin 基準の公開パス。
Font.register({
  family: 'NotoSansJP',
  src: '/fonts/NotoSansJP-Regular.woff',
})

// 長い表で行が改ページ境界に跨る際、CJK が改行されず崩れるのを避ける
Font.registerHyphenationCallback((word) => [word])

const styles = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansJP',
    fontSize: 8,
    paddingTop: 28,
    paddingBottom: 32,
    paddingHorizontal: 24,
    color: '#0f172a',
  },
  // ── ヘッダー ──
  header: {
    marginBottom: 12,
    borderBottomWidth: 1.5,
    borderBottomColor: '#1e3a8a',
    paddingBottom: 6,
  },
  title: { fontFamily: 'NotoSansJP', fontSize: 15, color: '#1e3a8a' },
  subtitle: { fontFamily: 'NotoSansJP', fontSize: 9, color: '#334155', marginTop: 3 },
  meta: { fontFamily: 'NotoSansJP', fontSize: 7.5, color: '#64748b', marginTop: 2 },
  // ── テーブル ──
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
    minHeight: 16,
    alignItems: 'center',
  },
  headRow: {
    flexDirection: 'row',
    backgroundColor: '#1e3a8a',
    minHeight: 18,
    alignItems: 'center',
  },
  zebra: { backgroundColor: '#f8fafc' },
  cell: { fontFamily: 'NotoSansJP', paddingHorizontal: 3, paddingVertical: 2 },
  headCell: {
    fontFamily: 'NotoSansJP',
    color: '#ffffff',
    fontSize: 7.5,
    paddingHorizontal: 3,
    paddingVertical: 3,
  },
  // ── フッター ──
  footer: {
    position: 'absolute',
    bottom: 16,
    left: 24,
    right: 24,
    fontFamily: 'NotoSansJP',
    fontSize: 6.5,
    color: '#94a3b8',
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 0.5,
    borderTopColor: '#e2e8f0',
    paddingTop: 4,
  },
})

// csv.ts の実カラムに対応（推測列は足さない）。都道府県はヘッダーに記載するため行から除外。
// align: 'l' 左寄せ（名称/コード） / 'r' 右寄せ（数値）。flex で列幅配分。
type Col = {
  key: string
  label: string
  flex: number
  align: 'l' | 'r'
  value: (m: MunicipalityWithStats) => string
}

const COLUMNS: Col[] = [
  { key: 'name', label: '市区町村', flex: 3, align: 'l', value: (m) => m.name },
  { key: 'code', label: 'コード', flex: 1.4, align: 'l', value: (m) => m.city_code ?? '—' },
  { key: 'popLatest', label: '人口(2025速報)', flex: 2, align: 'r', value: (m) => fmtInt(m.popLatest) },
  { key: 'popPrev', label: '人口(2020)', flex: 2, align: 'r', value: (m) => fmtInt(m.popPrev) },
  { key: 'hhLatest', label: '世帯数(2025速報)', flex: 2, align: 'r', value: (m) => fmtInt(m.householdsLatest) },
  { key: 'delta', label: '人口増減数', flex: 1.8, align: 'r', value: (m) => fmtSigned(m.delta) },
  { key: 'deltaRate', label: '増減率(%)', flex: 1.5, align: 'r', value: (m) => fmtRate(m.deltaRate) },
  { key: 'station', label: '駅乗降客数', flex: 1.8, align: 'r', value: (m) => fmtStation(m.stationPassengersTotal) },
]

function fmtInt(n: number | null): string {
  return n == null ? '—' : n.toLocaleString('ja-JP')
}
function fmtSigned(n: number | null): string {
  if (n == null) return '—'
  return (n > 0 ? '+' : '') + n.toLocaleString('ja-JP')
}
function fmtRate(n: number | null): string {
  if (n == null) return '—'
  return (n > 0 ? '+' : '') + n.toFixed(1)
}
function fmtStation(n: number): string {
  // csv.ts は 0 を空欄扱い。レポートでも 0/未投入は '—'。
  return n ? n.toLocaleString('ja-JP') : '—'
}

function todayLabel(): string {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// 表組みレポート本体。municipalities は呼び出し側で topLevel（区を除外）を渡す前提。
function AreaScoreReport({
  municipalities,
  prefecture,
}: {
  municipalities: MunicipalityWithStats[]
  prefecture: Prefecture
}) {
  const generated = todayLabel()
  return (
    <Document
      title={`エリアスコア レポート ${prefecture.name}`}
      author="エリアスコア"
    >
      <Page size="A4" orientation="landscape" style={styles.page}>
        {/* ヘッダー */}
        <View style={styles.header} fixed>
          <Text style={styles.title}>エリアスコア レポート</Text>
          <Text style={styles.subtitle}>
            対象エリア: {prefecture.name} ／ 全{municipalities.length}市区町村（2025年国勢調査・速報）
          </Text>
          <Text style={styles.meta}>生成日: {generated}</Text>
        </View>

        {/* テーブルヘッダー（各ページ先頭に繰り返し） */}
        <View style={styles.headRow} fixed>
          {COLUMNS.map((c) => (
            <Text
              key={c.key}
              style={[styles.headCell, { flex: c.flex, textAlign: c.align === 'r' ? 'right' : 'left' }]}
            >
              {c.label}
            </Text>
          ))}
        </View>

        {/* データ行 */}
        {municipalities.map((m, i) => (
          <View key={m.id} style={[styles.row, ...(i % 2 === 1 ? [styles.zebra] : [])]} wrap={false}>
            {COLUMNS.map((c) => (
              <Text
                key={c.key}
                style={[styles.cell, { flex: c.flex, textAlign: c.align === 'r' ? 'right' : 'left' }]}
              >
                {c.value(m)}
              </Text>
            ))}
          </View>
        ))}

        {/* フッター */}
        <View style={styles.footer} fixed>
          <Text style={{ fontFamily: 'NotoSansJP' }}>
            出典: 総務省 2025年国勢調査（速報集計）／ 国土交通省 駅別乗降客数（最新）。エリアスコアが生成。
          </Text>
          <Text
            style={{ fontFamily: 'NotoSansJP' }}
            render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  )
}

// ファイル名向けに安全化（パス区切り等を除去）。日本語はそのまま許容。
function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|\s]+/g, '_')
}

// クリック時に呼ぶ: Blob 生成 → ブラウザでダウンロード（CSV と同じ UX）。
export async function downloadAreaScorePDF(
  municipalities: MunicipalityWithStats[],
  prefecture: Prefecture,
): Promise<void> {
  const blob = await pdf(
    <AreaScoreReport municipalities={municipalities} prefecture={prefecture} />,
  ).toBlob()

  const d = new Date()
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `area-score_${safeName(prefecture.name)}_${ymd}.pdf`
  link.click()
  URL.revokeObjectURL(url)
}

// ============================================================
// PDF-B: 商圏レポート（T11・Platinum）。選択中市区町村の商圏サマリを1枚PDFに。
//   - 既存 Font.register('NotoSansJP') と pdf().toBlob() 作法を踏襲（同モジュールで再利用）。
//   - 原則1: 確定（公表値・事実）と推定（ルールベース参考値）を PDF 内でも明確に分離。
//     推定セクションには「推定」表記＋根拠(reason)＋免責を付け、確定と混ぜない。
//   - pdfLogo エンタイトルメント時はブランド文字ヘッダを差し込む（画像ロゴ資産が未用意のため
//     現状はテキストのブランドマーク。資産が来たら <Image> に差し替え可）。
// ============================================================

export interface TradeAreaConfirmed {
  popLatest: number | null
  popPrev: number | null
  popPrev2: number | null
  householdsLatest: number | null
  delta: number | null
  deltaRate: number | null
  stationPassengersTotal: number
}
export type TradeAreaInferred =
  | { hasData: false }
  | {
      hasData: true
      asOf: string
      townCount: number
      rankCounts: { S: number; A: number; B: number; C: number; D: number }
      topAcquisitionScore: number | null
      topReason: string | null
    }
export interface TradeAreaSummary {
  name: string
  prefectureName: string | null
  confirmed: TradeAreaConfirmed
  inferred: TradeAreaInferred
  // pdfLogo エンタイトルメント（Platinum）。ブランドヘッダの出し分け。
  withLogo: boolean
}

const taStyles = StyleSheet.create({
  brand: { fontFamily: 'NotoSansJP', fontSize: 10, color: '#1e3a8a', marginBottom: 2 },
  sectionHead: {
    fontFamily: 'NotoSansJP',
    fontSize: 11,
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginTop: 14,
    marginBottom: 4,
  },
  confirmedHead: { backgroundColor: '#eff6ff', borderLeftWidth: 3, borderLeftColor: '#3b82f6', color: '#1e3a8a' },
  inferredHead: { backgroundColor: '#fff7ed', borderLeftWidth: 3, borderLeftColor: '#f59e0b', color: '#9a3412' },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
    paddingVertical: 3,
    paddingHorizontal: 6,
  },
  metricLabel: { fontFamily: 'NotoSansJP', fontSize: 9, color: '#475569' },
  metricValue: { fontFamily: 'NotoSansJP', fontSize: 9, color: '#0f172a' },
  note: { fontFamily: 'NotoSansJP', fontSize: 8, color: '#64748b', paddingHorizontal: 6, marginTop: 4, lineHeight: 1.4 },
  reason: { fontFamily: 'NotoSansJP', fontSize: 7.5, color: '#475569', paddingHorizontal: 6, marginTop: 3, lineHeight: 1.4 },
})

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={taStyles.metricRow}>
      <Text style={taStyles.metricLabel}>{label}</Text>
      <Text style={taStyles.metricValue}>{value}</Text>
    </View>
  )
}

function TradeAreaReport({ summary }: { summary: TradeAreaSummary }) {
  const c = summary.confirmed
  const inf = summary.inferred
  const generated = todayLabel()
  const areaTitle = [summary.prefectureName, summary.name].filter(Boolean).join(' ')
  return (
    <Document title={`商圏レポート ${areaTitle}`} author="エリアスコア">
      <Page size="A4" style={styles.page}>
        {/* ヘッダー（pdfLogo 時はブランド文字ヘッダ） */}
        <View style={styles.header} fixed>
          {summary.withLogo && <Text style={taStyles.brand}>エリアスコア</Text>}
          <Text style={styles.title}>商圏レポート</Text>
          <Text style={styles.subtitle}>対象エリア: {areaTitle || '—'}</Text>
          <Text style={styles.meta}>生成日: {generated}</Text>
        </View>

        {/* 確定（公表値・事実） */}
        <Text style={[taStyles.sectionHead, taStyles.confirmedHead]}>確定（公表値・事実）</Text>
        <Metric label={`人口（${CENSUS.latestLabel}）`} value={fmtInt(c.popLatest)} />
        <Metric label={`人口（${CENSUS.prevLabel}）`} value={fmtInt(c.popPrev)} />
        <Metric label={`人口（${CENSUS.prev2Label}）`} value={fmtInt(c.popPrev2)} />
        <Metric label={`世帯数（${CENSUS.latestLabel}）`} value={fmtInt(c.householdsLatest)} />
        <Metric label={`人口増減数（${CENSUS.deltaRangeLabel}）`} value={fmtSigned(c.delta)} />
        <Metric
          label={`人口増減率（${CENSUS.deltaRangeLabel}）`}
          value={c.deltaRate == null ? '—' : `${fmtRate(c.deltaRate)}%`}
        />
        <Metric label="駅乗降客数（合計・最新）" value={fmtStation(c.stationPassengersTotal)} />

        {/* 推定（ルールベース・参考値） */}
        <Text style={[taStyles.sectionHead, taStyles.inferredHead]}>推定（ルールベース・参考値）［推定］</Text>
        {!inf.hasData ? (
          <Text style={taStyles.note}>このエリアの詳細スコア（町域別）は順次対応予定です。</Text>
        ) : (
          <>
            <Metric
              label="最高 取得スコア（推定）"
              value={inf.topAcquisitionScore == null ? '—' : inf.topAcquisitionScore.toFixed(1)}
            />
            <Metric
              label="推定ランク内訳（S/A/B/C/D）"
              value={`S${inf.rankCounts.S} / A${inf.rankCounts.A} / B${inf.rankCounts.B} / C${inf.rankCounts.C} / D${inf.rankCounts.D}`}
            />
            <Metric
              label="対象町域数 / 基準月"
              value={`${inf.townCount.toLocaleString('ja-JP')} 町域 / ${inf.asOf}`}
            />
            {inf.topReason && (
              <Text style={taStyles.reason}>最高スコア町域の計算根拠（推定）: {inf.topReason}</Text>
            )}
          </>
        )}

        <Text style={taStyles.note}>
          ※「推定」はルールベースの参考値です。物件の特定・売買の可否を断定するものではありません。
        </Text>

        {/* フッター */}
        <View style={styles.footer} fixed>
          <Text style={{ fontFamily: 'NotoSansJP' }}>
            出典: 総務省 国勢調査（e-Stat）／ 国土交通省 駅別乗降客数。エリアスコアが生成。
          </Text>
          <Text
            style={{ fontFamily: 'NotoSansJP' }}
            render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  )
}

// クリック時に呼ぶ: Blob 生成 → ダウンロード（downloadAreaScorePDF と同じ UX）。
export async function downloadTradeAreaPDF(summary: TradeAreaSummary): Promise<void> {
  const blob = await pdf(<TradeAreaReport summary={summary} />).toBlob()
  const d = new Date()
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `trade-area_${safeName(summary.name)}_${ymd}.pdf`
  link.click()
  URL.revokeObjectURL(url)
}

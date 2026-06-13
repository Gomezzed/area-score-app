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
  { key: 'pop2020', label: '人口(2020)', flex: 2, align: 'r', value: (m) => fmtInt(m.pop2020) },
  { key: 'pop2015', label: '人口(2015)', flex: 2, align: 'r', value: (m) => fmtInt(m.pop2015) },
  { key: 'hh2020', label: '世帯数(2020)', flex: 2, align: 'r', value: (m) => fmtInt(m.households2020) },
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
            対象エリア: {prefecture.name} ／ 全{municipalities.length}市区町村（2020年国勢調査）
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
            出典: 総務省 2020年国勢調査 ／ 国土交通省 駅別乗降客数（最新）。エリアスコアが生成。
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

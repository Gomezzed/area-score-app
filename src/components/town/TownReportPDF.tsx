/**
 * ============================================================================
 *  src/components/town/TownReportPDF.tsx
 *  町丁目分析レポート PDF (タスク #7: PDFレポート出力)
 * ============================================================================
 *  - @react-pdf/renderer を使用 (純粋なPDF生成、ピクセル画像化ではない)
 *  - 日本語フォント: Noto Sans JP (Google Fonts CDN から読み込み)
 *  - 折れ線グラフは react-pdf の Svg プリミティブで自前描画
 *    (Recharts は DOM ベースのため PDF 化できない)
 *
 *  構成:
 *    Page 1   : 表紙 + サマリー
 *    Page 2   : ランキング TOP 20
 *    Page 3-7 : TOP 5 町丁目の人口推移グラフ (1ページ1町丁目)
 *    Page 末  : データ出典・免責
 * ============================================================================
 */

import {
  Document, Page, View, Text, Font, StyleSheet,
  Svg, Line, Polyline, Circle, Rect, G,
} from '@react-pdf/renderer'
import type { InflowRankingRow } from '@/types/town'
import type { PopulationPoint } from '@/hooks/useTownInflow'

// ----------------------------------------------------------------------------
// フォント登録 (モジュール初回ロード時に1回実行)
// 日本語表示には必須。Google Fonts の Noto Sans JP を CDN から取得。
// ----------------------------------------------------------------------------
Font.register({
  family: 'NotoSansJP',
  fonts: [
    {
      src: 'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-jp@5.0.18/files/noto-sans-jp-japanese-400-normal.woff',
      fontWeight: 400,
    },
    {
      src: 'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-jp@5.0.18/files/noto-sans-jp-japanese-700-normal.woff',
      fontWeight: 700,
    },
  ],
})

// 行頭・行末禁則文字を無効化 (日本語の自動改行を自然にする)
Font.registerHyphenationCallback((word) => [word])

// ----------------------------------------------------------------------------
// スタイル定義
// ----------------------------------------------------------------------------
const COLORS = {
  bg:        '#ffffff',
  text:      '#0f172a',
  muted:     '#64748b',
  border:    '#e2e8f0',
  accent:    '#0ea5e9',
  pink:      '#ec4899',
  emerald:   '#10b981',
  amber:     '#f59e0b',
  rose:      '#f43f5e',
  slate100:  '#f1f5f9',
  slate200:  '#e2e8f0',
  slate800:  '#1e293b',
} as const

const styles = StyleSheet.create({
  page: {
    fontFamily:    'NotoSansJP',
    fontSize:      10,
    color:         COLORS.text,
    backgroundColor: COLORS.bg,
    paddingTop:    36,
    paddingBottom: 48,
    paddingHorizontal: 36,
  },
  // 表紙
  coverWrap: { flexGrow: 1, justifyContent: 'center', alignItems: 'flex-start' },
  brand:     { fontSize: 11, color: COLORS.accent, letterSpacing: 2, marginBottom: 8, fontWeight: 700 },
  title:     { fontSize: 28, fontWeight: 700, color: COLORS.text, marginBottom: 4 },
  subtitle:  { fontSize: 18, color: COLORS.muted, marginBottom: 28 },
  metaRow:   { flexDirection: 'row', marginBottom: 4 },
  metaLabel: { fontSize: 10, color: COLORS.muted, width: 90 },
  metaValue: { fontSize: 10, color: COLORS.text, fontWeight: 700 },
  summaryBox: {
    marginTop: 28,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    width: '100%',
  },
  summaryGrid: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  summaryItem: { alignItems: 'flex-start' },
  summaryLabel: { fontSize: 9, color: COLORS.muted, marginBottom: 2 },
  summaryNumber: { fontSize: 22, fontWeight: 700, color: COLORS.text },
  summaryUnit: { fontSize: 9, color: COLORS.muted, marginLeft: 2 },

  // ページヘッダ・フッタ
  pageHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingBottom: 8, marginBottom: 14,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  pageHeaderTitle: { fontSize: 14, fontWeight: 700, color: COLORS.text },
  pageHeaderMeta:  { fontSize: 9, color: COLORS.muted },
  footer: {
    position: 'absolute', bottom: 18, left: 36, right: 36,
    flexDirection: 'row', justifyContent: 'space-between',
    fontSize: 8, color: COLORS.muted,
    borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 6,
  },

  // ランキングテーブル
  table: { width: '100%' },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: COLORS.slate100,
    paddingVertical: 6, paddingHorizontal: 4,
    borderBottomWidth: 1.2, borderBottomColor: COLORS.slate200,
  },
  tableHeaderCell: { fontSize: 8, fontWeight: 700, color: COLORS.muted },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5, paddingHorizontal: 4,
    borderBottomWidth: 0.5, borderBottomColor: COLORS.border,
  },
  tableRowAlt: { backgroundColor: '#fafbfc' },
  tableCell:  { fontSize: 9, color: COLORS.text },

  // バッジ
  badgeInflow: {
    backgroundColor: '#fce7f3',
    color: '#9d174d',
    paddingHorizontal: 4, paddingVertical: 1.5,
    borderRadius: 3, fontSize: 7, fontWeight: 700,
  },
  badgeMuted: { color: COLORS.muted, fontSize: 8 },

  // チャートページ
  chartSectionTitle: { fontSize: 16, fontWeight: 700, marginBottom: 4 },
  chartSectionSub:   { fontSize: 10, color: COLORS.muted, marginBottom: 16 },
  metricsRow:        { flexDirection: 'row', marginBottom: 16, justifyContent: 'space-between' },
  metricBox: {
    flex: 1, marginHorizontal: 3,
    padding: 8, borderWidth: 1, borderColor: COLORS.border, borderRadius: 4,
  },
  metricLabel: { fontSize: 8, color: COLORS.muted, marginBottom: 3 },
  metricValue: { fontSize: 14, fontWeight: 700, color: COLORS.text },

  // 凡例
  legendRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 10 },
  legendSwatch: { width: 10, height: 2, marginRight: 4 },
  legendLabel: { fontSize: 8, color: COLORS.muted },
})

// ----------------------------------------------------------------------------
// SVG 折れ線グラフ (Recharts 代替: react-pdf 用の自前描画)
// ----------------------------------------------------------------------------
interface LineChartProps {
  data:    PopulationPoint[]
  width:   number
  height:  number
}

function LineChartSvg({ data, width, height }: LineChartProps) {
  const padding = { top: 12, right: 16, bottom: 22, left: 44 }
  const innerW = width  - padding.left - padding.right
  const innerH = height - padding.top  - padding.bottom

  // 全系列の max を求めて Y 軸スケール統一
  const allYs = data.flatMap((d) => [d.total_population, d.age_family_total, d.age_65_plus])
  const maxY  = Math.max(...allYs, 1)
  const minX  = Math.min(...data.map((d) => d.year))
  const maxX  = Math.max(...data.map((d) => d.year))
  const xRange = Math.max(maxX - minX, 1)

  const xScale = (year: number)  => padding.left + ((year - minX) / xRange) * innerW
  const yScale = (value: number) => padding.top + innerH - (value / maxY) * innerH

  // Y軸グリッド (4分割)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    value: maxY * t,
    y:     padding.top + innerH * (1 - t),
  }))

  function buildPoints(getter: (d: PopulationPoint) => number): string {
    return data.map((d) => `${xScale(d.year).toFixed(1)},${yScale(getter(d)).toFixed(1)}`).join(' ')
  }
  const totalPts  = buildPoints((d) => d.total_population)
  const familyPts = buildPoints((d) => d.age_family_total)
  const seniorPts = buildPoints((d) => d.age_65_plus)

  function fmtY(v: number): string {
    if (v >= 10_000) return (v / 10_000).toFixed(1) + '万'
    return v.toLocaleString()
  }

  return (
    <Svg width={width} height={height}>
      {/* 背景 */}
      <Rect x={padding.left} y={padding.top} width={innerW} height={innerH} fill="#fafbfc" />

      {/* Y軸グリッド線 + ラベル */}
      {yTicks.map((t, i) => (
        <G key={i}>
          <Line
            x1={padding.left} y1={t.y}
            x2={padding.left + innerW} y2={t.y}
            stroke={COLORS.slate200} strokeWidth={0.5}
            strokeDasharray="2 2"
          />
          <Text
            style={{ fontSize: 7, fill: COLORS.muted }}
            x={padding.left - 4}
            y={t.y + 2}
          >
            {fmtY(t.value)}
          </Text>
        </G>
      ))}

      {/* X軸ラベル (年) */}
      {data.map((d, i) => (
        <Text
          key={i}
          style={{ fontSize: 7, fill: COLORS.muted }}
          x={xScale(d.year) - 8}
          y={padding.top + innerH + 12}
        >
          {String(d.year)}
        </Text>
      ))}

      {/* 折れ線: 総人口 */}
      <Polyline
        points={totalPts}
        stroke={COLORS.accent} strokeWidth={1.8}
        fill="none"
      />
      {/* 折れ線: ファミリー世代 (20-49歳) */}
      <Polyline
        points={familyPts}
        stroke={COLORS.pink} strokeWidth={1.5}
        fill="none" strokeDasharray="3 2"
      />
      {/* 折れ線: 高齢者 (65+) */}
      <Polyline
        points={seniorPts}
        stroke={COLORS.amber} strokeWidth={1.5}
        fill="none" strokeDasharray="2 2"
      />

      {/* データ点 (各折れ線) */}
      {data.map((d, i) => (
        <G key={`pt-${i}`}>
          <Circle cx={xScale(d.year)} cy={yScale(d.total_population)} r={2.5} fill={COLORS.accent} />
          <Circle cx={xScale(d.year)} cy={yScale(d.age_family_total)} r={2}   fill={COLORS.pink}   />
          <Circle cx={xScale(d.year)} cy={yScale(d.age_65_plus)}      r={2}   fill={COLORS.amber}  />
        </G>
      ))}

      {/* 軸線 */}
      <Line
        x1={padding.left} y1={padding.top + innerH}
        x2={padding.left + innerW} y2={padding.top + innerH}
        stroke={COLORS.muted} strokeWidth={0.8}
      />
      <Line
        x1={padding.left} y1={padding.top}
        x2={padding.left} y2={padding.top + innerH}
        stroke={COLORS.muted} strokeWidth={0.8}
      />
    </Svg>
  )
}

// ----------------------------------------------------------------------------
// チャート凡例
// ----------------------------------------------------------------------------
function Legend() {
  const items = [
    { color: COLORS.accent, label: '総人口' },
    { color: COLORS.pink,   label: 'ファミリー世代 (20-49歳)' },
    { color: COLORS.amber,  label: '高齢者 (65歳以上)' },
  ]
  return (
    <View style={styles.legendRow}>
      {items.map((it, i) => (
        <View key={i} style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: it.color }]} />
          <Text style={styles.legendLabel}>{it.label}</Text>
        </View>
      ))}
    </View>
  )
}

// ----------------------------------------------------------------------------
// 数値フォーマッタ
// ----------------------------------------------------------------------------
function fmtNum(n: number): string { return n.toLocaleString() }
function fmtPopShort(n: number): string {
  if (Math.abs(n) >= 10_000) return (n / 10_000).toFixed(1) + '万'
  return n.toLocaleString()
}
function fmtPct(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'
}

// ----------------------------------------------------------------------------
// PDF Document コンポーネント
// ----------------------------------------------------------------------------
export interface TownReportHistoryEntry {
  row:    InflowRankingRow
  points: PopulationPoint[]
}

export interface TownReportProps {
  cityNameEn:   string
  cityName:     string
  top20:        InflowRankingRow[]
  histories:    TownReportHistoryEntry[]    // 上位 N 件 (通常 5 件)
  totalCount:   number
  inflowCount:  number
  /** 生成日時 (ISO 文字列または整形済み文字列) */
  generatedAt?: string
}

export function TownReportPDF({
  cityNameEn,
  cityName,
  top20,
  histories,
  totalCount,
  inflowCount,
  generatedAt,
}: TownReportProps) {
  const date  = generatedAt ?? new Date().toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
  const topScore = top20.length > 0 ? top20[0].inflow_score : 0

  return (
    <Document
      title={`町丁目分析レポート_${cityName}`}
      author="エリアスコア"
      creator="エリアスコア / Area Score SaaS"
      producer="@react-pdf/renderer"
    >
      {/* ──────── 表紙 ──────── */}
      <Page size="A4" style={styles.page}>
        <View style={styles.coverWrap}>
          <Text style={styles.brand}>AREA SCORE / 媒介取得支援</Text>
          <Text style={styles.title}>町丁目分析レポート</Text>
          <Text style={styles.subtitle}>{cityName}（{cityNameEn}）</Text>

          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>出力日時:</Text>
            <Text style={styles.metaValue}>{date}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>対象データ:</Text>
            <Text style={styles.metaValue}>国勢調査 2015 → 2020 (e-Stat)</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>判定軸:</Text>
            <Text style={styles.metaValue}>人口増 / 世帯増の差 × 20-49歳ファミリー世代流入</Text>
          </View>

          <View style={styles.summaryBox}>
            <Text style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>サマリー</Text>
            <View style={styles.summaryGrid}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>対象町丁目数</Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                  <Text style={styles.summaryNumber}>{fmtNum(totalCount)}</Text>
                  <Text style={styles.summaryUnit}>件</Text>
                </View>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>若返り判定エリア</Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                  <Text style={[styles.summaryNumber, { color: COLORS.pink }]}>{fmtNum(inflowCount)}</Text>
                  <Text style={styles.summaryUnit}>件</Text>
                </View>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>判定割合</Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                  <Text style={styles.summaryNumber}>
                    {totalCount > 0 ? ((inflowCount / totalCount) * 100).toFixed(1) : '0.0'}
                  </Text>
                  <Text style={styles.summaryUnit}>%</Text>
                </View>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>最高スコア</Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                  <Text style={styles.summaryNumber}>{topScore.toFixed(1)}</Text>
                  <Text style={styles.summaryUnit}>/ 100</Text>
                </View>
              </View>
            </View>
          </View>

          <Text style={{ fontSize: 9, color: COLORS.muted, marginTop: 16, lineHeight: 1.5 }}>
            本レポートは媒介取得営業の優先順位付けを支援するために自動生成されたものです。
            「若返り判定」は人口増加・世帯数増加の差分（ファミリー指数）と
            20〜49歳人口の増加率を組み合わせたシステム独自指標です。
          </Text>
        </View>

        <View style={styles.footer}>
          <Text>エリアスコア / Area Score SaaS</Text>
          <Text>表紙 / 全 {2 + histories.length + 1} ページ</Text>
        </View>
      </Page>

      {/* ──────── ランキング TOP 20 ──────── */}
      <Page size="A4" style={styles.page}>
        <View style={styles.pageHeader}>
          <Text style={styles.pageHeaderTitle}>ランキング TOP 20</Text>
          <Text style={styles.pageHeaderMeta}>{cityName} / inflow_score 降順</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, { width: 22 }]}>#</Text>
            <Text style={[styles.tableHeaderCell, { flex: 1 }]}>町丁目</Text>
            <Text style={[styles.tableHeaderCell, { width: 50, textAlign: 'right' }]}>スコア</Text>
            <Text style={[styles.tableHeaderCell, { width: 56, textAlign: 'right' }]}>家族指数</Text>
            <Text style={[styles.tableHeaderCell, { width: 64, textAlign: 'right' }]}>人口増減</Text>
            <Text style={[styles.tableHeaderCell, { width: 52, textAlign: 'right' }]}>20-49%</Text>
            <Text style={[styles.tableHeaderCell, { width: 60, textAlign: 'center' }]}>若返り</Text>
          </View>
          {top20.map((r, i) => (
            <View
              key={r.town_id}
              style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}
            >
              <Text style={[styles.tableCell, { width: 22, color: COLORS.muted }]}>{i + 1}</Text>
              <Text style={[styles.tableCell, { flex: 1 }]}>{r.town_name}</Text>
              <Text style={[styles.tableCell, { width: 50, textAlign: 'right', fontWeight: 700, color: COLORS.accent }]}>
                {r.inflow_score.toFixed(1)}
              </Text>
              <Text style={[styles.tableCell, { width: 56, textAlign: 'right',
                color: r.family_index > 0 ? COLORS.emerald : r.family_index < 0 ? COLORS.rose : COLORS.muted }]}>
                {r.family_index > 0 ? '+' : ''}{fmtNum(r.family_index)}
              </Text>
              <Text style={[styles.tableCell, { width: 64, textAlign: 'right' }]}>
                {r.population_delta_abs >= 0 ? '+' : ''}{fmtNum(r.population_delta_abs)}{' '}
                <Text style={{ color: COLORS.muted, fontSize: 7 }}>
                  ({fmtPct(r.population_delta_pct)})
                </Text>
              </Text>
              <Text style={[styles.tableCell, { width: 52, textAlign: 'right',
                color: r.young_family_delta_pct >= 0 ? COLORS.pink : COLORS.muted }]}>
                {fmtPct(r.young_family_delta_pct)}
              </Text>
              <View style={{ width: 60, alignItems: 'center', justifyContent: 'center' }}>
                {r.is_young_family_inflow
                  ? <Text style={styles.badgeInflow}>若返りエリア</Text>
                  : <Text style={styles.badgeMuted}>—</Text>}
              </View>
            </View>
          ))}
        </View>

        <View style={styles.footer}>
          <Text>エリアスコア / {cityName}</Text>
          <Text>ランキング / 2 ページ</Text>
        </View>
      </Page>

      {/* ──────── TOP 5 各町丁目 人口推移グラフ ──────── */}
      {histories.map((entry, idx) => {
        const r = entry.row
        const pts = entry.points
        const latest   = pts[pts.length - 1]
        const earliest = pts[0]
        const popDelta = latest && earliest ? latest.total_population - earliest.total_population : 0
        const popPct   = earliest && earliest.total_population > 0
          ? (popDelta / earliest.total_population * 100) : 0

        return (
          <Page key={r.town_id} size="A4" style={styles.page}>
            <View style={styles.pageHeader}>
              <Text style={styles.pageHeaderTitle}>#{idx + 1}  {r.town_name}</Text>
              <Text style={styles.pageHeaderMeta}>
                スコア {r.inflow_score.toFixed(1)} ・
                {r.is_young_family_inflow ? ' 若返りエリア判定' : ' (通常エリア)'}
              </Text>
            </View>

            <Text style={styles.chartSectionTitle}>人口推移</Text>
            <Text style={styles.chartSectionSub}>
              {earliest?.year ?? '—'}年 → {latest?.year ?? '—'}年 ・
              {' '}{popDelta >= 0 ? '+' : ''}{fmtPopShort(popDelta)} 人 ({fmtPct(popPct)})
            </Text>

            <View style={styles.metricsRow}>
              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>最新総人口</Text>
                <Text style={styles.metricValue}>
                  {latest ? fmtPopShort(latest.total_population) : '—'}{' '}
                  <Text style={{ fontSize: 9, color: COLORS.muted, fontWeight: 400 }}>人</Text>
                </Text>
              </View>
              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>ファミリー世代増減</Text>
                <Text style={[styles.metricValue, {
                  color: r.young_family_delta_pct >= 0 ? COLORS.pink : COLORS.muted,
                }]}>
                  {fmtPct(r.young_family_delta_pct)}
                </Text>
              </View>
              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>ファミリー指数</Text>
                <Text style={[styles.metricValue, {
                  color: r.family_index > 0 ? COLORS.emerald : r.family_index < 0 ? COLORS.rose : COLORS.muted,
                }]}>
                  {r.family_index > 0 ? '+' : ''}{fmtNum(r.family_index)}
                </Text>
              </View>
              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>1世帯人数 (最新)</Text>
                <Text style={styles.metricValue}>
                  {latest ? latest.avg_household_size.toFixed(2) : '—'}{' '}
                  <Text style={{ fontSize: 9, color: COLORS.muted, fontWeight: 400 }}>人</Text>
                </Text>
              </View>
            </View>

            {pts.length >= 2 ? (
              <>
                <LineChartSvg data={pts} width={520} height={240} />
                <Legend />
              </>
            ) : (
              <View style={{ height: 240, justifyContent: 'center', alignItems: 'center',
                             backgroundColor: COLORS.slate100, borderRadius: 4 }}>
                <Text style={{ color: COLORS.muted, fontSize: 10 }}>
                  時系列データが1点しかないため、折れ線描画を省略しています
                </Text>
              </View>
            )}

            <View style={styles.footer}>
              <Text>エリアスコア / {r.town_name}</Text>
              <Text>{3 + idx} ページ</Text>
            </View>
          </Page>
        )
      })}

      {/* ──────── 最終ページ: データ出典・免責 ──────── */}
      <Page size="A4" style={styles.page}>
        <View style={styles.pageHeader}>
          <Text style={styles.pageHeaderTitle}>データ出典・補足</Text>
          <Text style={styles.pageHeaderMeta}>{cityName}</Text>
        </View>

        <Text style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>データ出典</Text>
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 9, color: COLORS.muted, lineHeight: 1.6 }}>
            ・人口・世帯・年齢階級: 総務省統計局 e-Stat 国勢調査 小地域集計
            （https://www.e-stat.go.jp/）
          </Text>
          <Text style={{ fontSize: 9, color: COLORS.muted, lineHeight: 1.6 }}>
            ・町丁目境界: 国土数値情報 行政区域データ（国土交通省）
          </Text>
        </View>

        <Text style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>スコア算出方法</Text>
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 9, color: COLORS.text, lineHeight: 1.6 }}>
            inflow_score (0-100) = 人口増加率 (30%) + ファミリー指数 (35%) + 20-49歳増加率 (35%)
          </Text>
          <Text style={{ fontSize: 9, color: COLORS.muted, lineHeight: 1.6, marginTop: 4 }}>
            ・ファミリー指数 = 人口増加数 − 世帯数増加数 (1世帯あたり人数の純増)
          </Text>
          <Text style={{ fontSize: 9, color: COLORS.muted, lineHeight: 1.6 }}>
            ・若返り判定 = 3 つの閾値 (scoring_config) を AND で満たすエリアに True
          </Text>
        </View>

        <Text style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>免責事項</Text>
        <Text style={{ fontSize: 8, color: COLORS.muted, lineHeight: 1.6 }}>
          本レポートのスコア・ランキングはシステムによる自動計算結果であり、
          実需要・物件流通性を保証するものではありません。営業活動の優先順位付け参考資料として
          ご活用ください。出典データの取得時期によっては最新動向と乖離する場合があります。
        </Text>

        <View style={styles.footer}>
          <Text>エリアスコア / 出典・免責</Text>
          <Text>最終ページ</Text>
        </View>
      </Page>
    </Document>
  )
}

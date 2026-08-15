'use client'

import dynamic from 'next/dynamic'
import {
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
  Suspense,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { useSubscription } from '@/hooks/useSubscription'
import { usePlanLimit, FREE_VISIBLE_AREA_LIMIT } from '@/hooks/usePlanLimit'
import { usePrefectures } from '@/hooks/useCensus'
import { useDashboardUrlState } from '@/hooks/useDashboardUrlState'
// 注: ログアウトは useAuth().signOut を使用（supabase クライアントの直接importは不要）
import { REGIONS } from '@/lib/census'
import { PrefectureDropdown } from '@/components/ui/PrefectureDropdown'
import { MunicipalityList } from '@/components/ui/MunicipalityList'
import { MunicipalityDetailPanel } from '@/components/ui/MunicipalityDetailPanel'
import { TownHighlightsPanel } from '@/components/ui/TownHighlightsPanel'
import { generateMunicipalityCSV, downloadCSV } from '@/lib/csv'
import { SheetsExportButton } from '@/components/ui/SheetsExportButton'
import { canUse } from '@/lib/plans'
import { LogOut, Download, FileText, RefreshCw, HelpCircle, Lock, Sparkles, CreditCard, Loader2, Trophy, Scale, Users, ChevronDown, FileSpreadsheet } from 'lucide-react'
import { Logo } from '@/components/Logo'

// Leaflet は SSR 不可のため dynamic import
const MunicipalityMap = dynamic(
  () => import('@/components/map/MunicipalityMap').then((m) => m.MunicipalityMap),
  { ssr: false, loading: () => <div className="w-full h-full bg-slate-100 animate-pulse rounded-lg" /> },
)

// 共通のフルスクリーン ローディング（Suspense fallback と prefLoading で共用）
function DashboardLoading() {
  return (
    <div className="min-h-screen bg-page-bg flex items-center justify-center">
      <div className="text-slate-500 flex items-center gap-3 text-sm">
        <RefreshCw className="w-5 h-5 animate-spin" />
        読み込み中...
      </div>
    </div>
  )
}

// プラン未達の分析機能も全プランに表示する（D43-② 案Q）。権限が無い場合はこのロック
//   ボタンを描画し、クリックで /pricing へ誘導する（MunicipalityList の onLockedClick と同じ導線）。
//   ここで描画するのはボタン(導線)のみで、実データは一切クライアントに渡さない（原則12）。
//   実データを扱うパネル/ルート側でも canUse による自己ゲートが別途働くため、錠の表示は
//   権限の緩和にはならない。
function LockedFeatureButton({
  icon,
  label,
  title,
  onUpsell,
}: {
  icon: ReactNode
  label: string
  title: string
  onUpsell: () => void
}) {
  return (
    <button
      onClick={onUpsell}
      className="flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 min-w-[44px] sm:min-w-0 px-2 sm:px-3 py-1.5 bg-white hover:bg-brand-100 border border-[#C7D6E4] text-slate-400 rounded-lg text-sm font-medium transition-colors"
      title={title}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
      <Lock className="w-3.5 h-3.5 text-brand-700" />
    </button>
  )
}

// データ出力メニュー（S5）。PDF出力 / CSV出力 / Sheetsに出力 を「データ出力 ▾」1つに集約する。
//   案A: ボタン自体は全プランで常に表示・常に開ける（非表示・不能化しない）。開いた中の各項目に、
//   権限が無ければ錠（locked）を付ける。⚠ 権限の無い項目をメニューから消す実装は禁止（案Q に反する）。
//   錠項目クリックで /pricing へ。キーボード操作（Esc で閉じる・矢印/Tab で項目間トラップ）と
//   aria 属性（haspopup=menu / expanded / role=menu / menuitem）を備える。
type ExportMenuItem =
  // 権限あり: 実行アクション（PDF/CSV）
  | {
      kind: 'action'
      key: string
      icon: ReactNode
      label: string
      onSelect: () => void
      disabled?: boolean
    }
  // 権限なし: 錠つき導線（/pricing へ）。メニューからは消さない。
  | {
      kind: 'locked'
      key: string
      icon: ReactNode
      label: string
      title: string
      onUpsell: () => void
    }
  // 既製のメニュー項目コンポーネントをそのまま差し込む（Sheets 出力＝SheetsExportButton）
  | { kind: 'node'; key: string; node: ReactNode }

function ExportMenu({ items }: { items: ExportMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback((refocus = true) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }, [])

  // 外側クリックで閉じる（トリガー/メニュー外の mousedown）。
  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  // 開いたら先頭の有効な項目へフォーカスを移す。
  useEffect(() => {
    if (!open) return
    const first = menuRef.current?.querySelector<HTMLElement>(
      '[role="menuitem"]:not([disabled])',
    )
    first?.focus()
  }, [open])

  // メニュー内の有効な menuitem 一覧（矢印/Tab のトラップ対象）。
  function focusables(): HTMLElement[] {
    return Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    ).filter((el) => !el.hasAttribute('disabled'))
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    const els = focusables()
    if (els.length === 0) return
    const idx = els.indexOf(document.activeElement as HTMLElement)
    // Tab は外へ出さずメニュー内で循環させる＝フォーカストラップ。
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault()
      els[(idx + 1) % els.length]?.focus()
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault()
      els[(idx - 1 + els.length) % els.length]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      els[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      els[els.length - 1]?.focus()
    }
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 min-w-[44px] sm:min-w-0 px-2 sm:px-3 py-1.5 bg-white hover:bg-brand-100 border border-[#C7D6E4] text-brand-700 rounded-lg text-sm font-medium transition-colors"
        title="データ出力"
      >
        <Download className="w-4 h-4" />
        <span className="hidden sm:inline">データ出力</span>
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="データ出力"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 z-30 mt-1 w-52 rounded-lg border border-[#C7D6E4] bg-white py-1 shadow-lg"
        >
          {items.map((it) =>
            it.kind === 'node' ? (
              // SheetsExportButton（menuItem）自身が role="menuitem"。クリックで親を閉じる。
              <div key={it.key} role="none" onClick={() => setOpen(false)}>
                {it.node}
              </div>
            ) : it.kind === 'locked' ? (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  it.onUpsell()
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-400 hover:bg-brand-100 transition-colors"
                title={it.title}
              >
                {it.icon}
                <span>{it.label}</span>
                <Lock className="ml-auto w-3.5 h-3.5 text-brand-700" />
              </button>
            ) : (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  it.onSelect()
                }}
                disabled={it.disabled}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-brand-700 hover:bg-brand-100 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors"
              >
                {it.icon}
                <span>{it.label}</span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}

// useSearchParams を使う本体は Suspense 境界の内側に置く（App Router 要件）
export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardContent />
    </Suspense>
  )
}

function DashboardContent() {
  const router = useRouter()
  const { user, signOut } = useAuth()
  const { plan, canAccessFull, hasBillingAccount } = useSubscription()
  // プラン別エンタイトルメント（エリア可視数・出力可否・駅単位の実利用可否）
  const limit = usePlanLimit(plan)
  const { prefectures, loading: prefLoading } = usePrefectures()

  // 表示状態（都道府県 / 政令市ドリル / 選択エリア）は URL クエリを単一の情報源として導出。
  //   region / activePref / expandedCity / selected と、市区町村データ・派生一覧・
  //   ドリル/選択アクションをまとめて取得する（詳細は useDashboardUrlState）。
  const {
    region,
    regionPrefs,
    activePref,
    municipalities,
    muniLoading,
    designatedNames,
    topLevel,
    displayed,
    expandedCity,
    selected,
    selectPref,
    selectRegion,
    exitCity,
    closeArea,
    handleSelect,
  } = useDashboardUrlState(prefectures)

  // 請求ポータルへの遷移中フラグ
  const [portalLoading, setPortalLoading] = useState(false)
  // PDF 生成中フラグ（クライアント生成のため数百ms〜のロード）
  const [pdfLoading, setPdfLoading] = useState(false)
  // 注目町域 TOP20 スライドオーバーの開閉（Platinum のみ）
  const [highlightsOpen, setHighlightsOpen] = useState(false)

  // 閲覧ルール v3 のロック判定はサーバー（get_municipalities_gated）が確定済み。
  //   各行の m.locked と NULL 化済み数値がそのまま届くため、クライアント側マスクは行わない。
  // 地図には閲覧可能な行のみ表示（ロック行は lat/lng が NULL のためマーカー描画不可）。
  const mapMunicipalities = useMemo(
    () => displayed.filter((m) => !m.locked),
    [displayed],
  )

  // リストは displayed をそのまま渡す（ロック行の伏字・アップグレード導線は MunicipalityList が
  //   m.locked を見て描画する）。
  const listMunicipalities = displayed

  function handleCSVDownload() {
    // 料金設計v2.1: CSV出力は Standard 以上の機能（Starter は PDF のみ可）
    if (!limit.canExportCsv) {
      router.push('/pricing')
      return
    }
    if (!activePref || topLevel.length === 0) return
    // 政令市の行政区（区）は二重計上を避けるためトップレベル（市区町村）のみ出力
    const csv = generateMunicipalityCSV(topLevel, activePref)
    const date = new Date().toISOString().split('T')[0]
    downloadCSV(csv, `population-${activePref.name_en}-${date}.csv`)
  }

  async function handlePDFDownload() {
    // 料金設計v2.1: PDF出力は Starter 以上の機能（canExportPdf）。CSV と同じ参照経路。
    if (!limit.canExportPdf) {
      router.push('/pricing')
      return
    }
    if (!activePref || topLevel.length === 0) return
    setPdfLoading(true)
    try {
      // @react-pdf/renderer は重く SSR 不可のため、クリック時に動的 import。
      // CSV と同じく topLevel（区を除いた市区町村）と activePref を渡す。
      const { downloadAreaScorePDF } = await import('@/lib/pdf')
      await downloadAreaScorePDF(topLevel, activePref)
    } catch (err) {
      alert(`PDF生成に失敗しました: ${String(err)}`)
    } finally {
      setPdfLoading(false)
    }
  }

  // 請求情報の管理: Stripe カスタマーポータルへ遷移
  async function handleManageBilling() {
    setPortalLoading(true)
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.url) {
        // route は { error: <code>, message: <日本語> } 形式。人間向けは message を優先。
        alert(data?.message ?? data?.error ?? '請求ポータルを開けませんでした。')
        setPortalLoading(false)
        return
      }
      window.location.assign(data.url)
    } catch (err) {
      alert(`通信エラー: ${String(err)}`)
      setPortalLoading(false)
    }
  }

  // データ出力メニュー（S5・案A）の項目。権限が無い項目は「消さず」錠つきで残す。
  //   PDF=starter+ / CSV=standard+ / Sheets=standard+。プラン判定は usePlanLimit（=canUse 集約）に
  //   由来し、ここでは緩めない（表示のみ・原則12）。Sheets はサーバー封鎖とは別に、UI 側マスター
  //   フラグ（NEXT_PUBLIC_FEATURE_SHEETS_EXPORT）が ON のときだけ「機能として存在」するため、
  //   OFF の環境では錠項目も含め出さない（存在を晒さない）。PDF/CSV はマスターフラグを持たない。
  const sheetsFlagOn =
    process.env.NEXT_PUBLIC_FEATURE_SHEETS_EXPORT === 'true'
  const exportItems: ExportMenuItem[] = [
    limit.canExportPdf
      ? {
          kind: 'action',
          key: 'pdf',
          icon: pdfLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <FileText className="w-4 h-4" />
          ),
          label: 'PDF出力',
          onSelect: handlePDFDownload,
          disabled: municipalities.length === 0 || pdfLoading,
        }
      : {
          kind: 'locked',
          key: 'pdf',
          icon: <FileText className="w-4 h-4" />,
          label: 'PDF出力',
          title: 'PDF出力は Starterプラン以上で利用可能です',
          onUpsell: () => router.push('/pricing'),
        },
    limit.canExportCsv
      ? {
          kind: 'action',
          key: 'csv',
          icon: <Download className="w-4 h-4" />,
          label: 'CSV出力',
          onSelect: handleCSVDownload,
          disabled: municipalities.length === 0,
        }
      : {
          kind: 'locked',
          key: 'csv',
          icon: <Download className="w-4 h-4" />,
          label: 'CSV出力',
          title: 'CSV出力は Standardプラン以上で利用可能です',
          onUpsell: () => router.push('/pricing'),
        },
    ...(sheetsFlagOn
      ? [
          limit.canExportSheets
            ? {
                kind: 'node' as const,
                key: 'sheets',
                node: (
                  <SheetsExportButton
                    menuItem
                    prefectureNameEn={activePref?.name_en}
                    disabled={topLevel.length === 0}
                  />
                ),
              }
            : {
                kind: 'locked' as const,
                key: 'sheets',
                icon: <FileSpreadsheet className="w-4 h-4" />,
                label: 'Sheetsに出力',
                title: 'Sheets出力は Standardプラン以上で利用可能です',
                onUpsell: () => router.push('/pricing'),
              },
        ]
      : []),
  ]

  if (prefLoading) {
    return <DashboardLoading />
  }

  return (
    <div className="h-screen bg-page-bg flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 flex-shrink-0">
        {/* Row 1: logo + actions */}
        <div className="px-3 sm:px-5 py-2 sm:py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Logo size="md" />
          </div>
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            {!canAccessFull ? (
              <Link
                href="/pricing"
                className="flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-2 sm:px-3 py-1.5 bg-brand-700 hover:bg-brand-500 text-white rounded-lg text-sm font-medium transition-colors"
                title="プランをアップグレード"
              >
                <Sparkles className="w-4 h-4" />
                <span className="hidden sm:inline">アップグレード</span>
              </Link>
            ) : hasBillingAccount ? (
              // 有効プランかつ Stripe 顧客が存在する場合のみ請求ポータルへの導線を出す。
              // コンプアカウント（stripe_customer_id = NULL）はポータル対象外のため描画しない。
              <button
                onClick={handleManageBilling}
                disabled={portalLoading}
                className="flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 min-w-[44px] sm:min-w-0 px-2 sm:px-3 py-1.5 text-slate-400 hover:text-brand-700 hover:bg-slate-100 disabled:opacity-60 rounded-lg text-sm transition-colors"
                title="請求情報を管理（プラン変更・解約）"
              >
                {portalLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CreditCard className="w-4 h-4" />
                )}
                <span className="hidden sm:inline">請求情報を管理</span>
              </button>
            ) : null}
            {/* データ出力（S5）: PDF出力 / CSV出力 / Sheetsに出力 を「データ出力 ▾」へ集約。
                案A: メニューは全プランで常に開ける。権限の無い項目は錠つきで残す（消さない）。
                分析3種＋顧客アタックリストはヘッダー直置きのまま（D43-④・畳まない）。 */}
            <ExportMenu items={exportItems} />
            {/* 分析系の導線は全プランに表示する（D43-② 案Q）。権限があれば実機能へ、無ければ
                錠つきボタン（LockedFeatureButton）で /pricing へ誘導する。錠側はボタン(導線)のみを
                描画し、データは一切クライアントに渡さない（原則12）。実データを扱うパネル/ルート側
                でも canUse による自己ゲート（例: TownHighlightsPanel は allowed=false で return null）
                が働くため、錠の表示が権限の緩和になることはない。権限判定は canUse に集約（§3）。 */}
            {/* 注目町域 TOP20（Platinum・townAcquisitionPriority） */}
            {canUse(plan, 'townAcquisitionPriority') ? (
              <button
                onClick={() => setHighlightsOpen(true)}
                className="flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 min-w-[44px] sm:min-w-0 px-2 sm:px-3 py-1.5 bg-brand-700 hover:bg-brand-500 text-white rounded-lg text-sm font-medium transition-colors"
                title="注目町域 TOP20（Platinum）"
              >
                <Trophy className="w-4 h-4" />
                <span className="hidden sm:inline">注目TOP20</span>
              </button>
            ) : (
              <LockedFeatureButton
                icon={<Trophy className="w-4 h-4" />}
                label="注目TOP20"
                title="注目町域 TOP20（Platinum プランで利用可能）"
                onUpsell={() => router.push('/pricing')}
              />
            )}
            {/* エリア比較（Platinum・areaCompare。存在するルート /dashboard/compare へ） */}
            {canUse(plan, 'areaCompare') ? (
              <Link
                href="/dashboard/compare"
                className="flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 min-w-[44px] sm:min-w-0 px-2 sm:px-3 py-1.5 bg-white hover:bg-brand-100 border border-[#C7D6E4] text-brand-700 rounded-lg text-sm font-medium transition-colors"
                title="エリア比較（Platinum）"
              >
                <Scale className="w-4 h-4" />
                <span className="hidden sm:inline">エリア比較</span>
              </Link>
            ) : (
              <LockedFeatureButton
                icon={<Scale className="w-4 h-4" />}
                label="エリア比較"
                title="エリア比較（Platinum プランで利用可能）"
                onUpsell={() => router.push('/pricing')}
              />
            )}
            {/* 商圏レポート（Platinum・tradeAreaReport。存在するルート /dashboard/trade-area へ） */}
            {canUse(plan, 'tradeAreaReport') ? (
              <Link
                href="/dashboard/trade-area"
                className="flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 min-w-[44px] sm:min-w-0 px-2 sm:px-3 py-1.5 bg-white hover:bg-brand-100 border border-[#C7D6E4] text-brand-700 rounded-lg text-sm font-medium transition-colors"
                title="商圏レポート（Platinum）"
              >
                <FileText className="w-4 h-4" />
                <span className="hidden sm:inline">商圏レポート</span>
              </Link>
            ) : (
              <LockedFeatureButton
                icon={<FileText className="w-4 h-4" />}
                label="商圏レポート"
                title="商圏レポート（Platinum プランで利用可能）"
                onUpsell={() => router.push('/pricing')}
              />
            )}
            {/* 商圏レポートとの区切り（分析ボタン群の末尾を視覚的に分離）。全プランで表示する。 */}
            <div aria-hidden className="hidden sm:block w-px h-6 bg-[#C7D6E4] mx-1" />
            {/* 顧客アタックリスト（Platinum・townAcquisitionPriority。plan 直書き禁止。存在する
                ルート /customers へ。注目TOP20 と同じ townAcquisitionPriority キーのため、非platinum
                では両方に同時に錠が出る。アイコンは /customers ヘッダーと同じ Users で視覚的に紐づけ） */}
            {canUse(plan, 'townAcquisitionPriority') ? (
              <Link
                href="/customers"
                className="flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 min-w-[44px] sm:min-w-0 px-2 sm:px-3 py-1.5 bg-white hover:bg-brand-100 border border-[#C7D6E4] text-brand-700 rounded-lg text-sm font-medium transition-colors"
                title="顧客アタックリスト（Platinum）"
              >
                <Users className="w-4 h-4" />
                <span className="hidden sm:inline">顧客アタックリスト</span>
              </Link>
            ) : (
              <LockedFeatureButton
                icon={<Users className="w-4 h-4" />}
                label="顧客アタックリスト"
                title="顧客アタックリスト（Platinum プランで利用可能）"
                onUpsell={() => router.push('/pricing')}
              />
            )}
            <Link
              href="/help"
              className="flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 min-w-[44px] sm:min-w-0 px-2 sm:px-3 py-1.5 text-slate-400 hover:text-brand-700 hover:bg-slate-100 rounded-lg text-sm transition-colors"
              title="使い方ガイド"
            >
              <HelpCircle className="w-4 h-4" />
              <span className="hidden sm:inline">ヘルプ</span>
            </Link>
            {user?.email && (
              <span
                className="hidden md:block max-w-[160px] truncate text-xs text-slate-400 px-2"
                title={user.email}
              >
                {user.email}
              </span>
            )}
            <button
              onClick={signOut}
              className="flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 min-w-[44px] sm:min-w-0 px-2 sm:px-3 py-1.5 text-slate-400 hover:text-brand-700 hover:bg-slate-100 rounded-lg text-sm transition-colors"
              title="ログアウト"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">ログアウト</span>
            </button>
          </div>
        </div>

        {/* Row 2: region tabs + prefecture dropdown */}
        <div className="px-3 pb-2 sm:pb-2.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <div
            className="flex gap-1 overflow-x-auto -mx-1 px-1 sm:mx-0 sm:px-0"
            style={{ scrollbarWidth: 'none' }}
          >
            {REGIONS.map((r) => (
              <button
                key={r.id}
                onClick={() => selectRegion(r.id)}
                className={`px-4 min-h-[44px] sm:min-h-0 sm:py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
                  r.id === region
                    ? 'bg-brand-700 text-white'
                    : 'text-slate-500 hover:text-brand-700'
                }`}
              >
                {r.name}
              </button>
            ))}
          </div>
          <div className="flex-shrink-0 w-full sm:w-auto">
            <PrefectureDropdown
              prefectures={regionPrefs}
              selectedCode={activePref?.code ?? ''}
              onSelect={selectPref}
            />
          </div>
        </div>
      </header>

      {/* Stats bar */}
      <div className="bg-[#FBFCFD] border-b border-slate-200 px-3 sm:px-5 py-2 flex items-center gap-4 sm:gap-6 flex-shrink-0">
        <span className="text-xs sm:text-xs text-slate-500 truncate">
          {activePref?.name ?? '—'} ｜ 全{topLevel.length}市区町村（2025年国勢調査・速報）
        </span>
        {muniLoading && (
          <span className="text-xs text-slate-500 flex items-center gap-1 flex-shrink-0">
            <RefreshCw className="w-3 h-3 animate-spin" /> 更新中
          </span>
        )}
      </div>

      {/* 無料プラン: アップグレード導線バナー */}
      {!canAccessFull && (
        <Link
          href="/pricing"
          className="flex items-center gap-2 bg-brand-100 hover:bg-brand-300/40 border-b border-brand-300 px-3 sm:px-5 py-2 text-sm text-brand-700 transition-colors flex-shrink-0"
        >
          <Lock className="w-4 h-4 flex-shrink-0 text-brand-700" />
          <span className="truncate">
            無料プランでは上位{FREE_VISIBLE_AREA_LIMIT}件のみ表示。全データを見るにはアップグレードが必要です
          </span>
          <span className="ml-auto flex-shrink-0 font-medium underline">料金を見る</span>
        </Link>
      )}

      {/* Main content */}
      <div className="flex-1 relative overflow-hidden">
        {/* List + Map（モバイル: 縦積み / デスクトップ: 横並び） */}
        <div className="absolute inset-0 flex flex-col md:flex-row">
          {/* Left: municipality list（モバイルは全幅・上段） */}
          <aside className="w-full md:w-72 flex-shrink-0 h-[42%] md:h-full border-b md:border-b-0 md:border-r border-slate-200 overflow-hidden">
            <MunicipalityList
              municipalities={listMunicipalities}
              selectedId={selected?.id ?? null}
              onSelect={handleSelect}
              expandableNames={designatedNames}
              drilldownCity={expandedCity}
              onBack={exitCity}
              onLockedClick={() => router.push('/pricing')}
            />
          </aside>

          {/* Map（残りの高さ） */}
          <div className="flex-1 relative overflow-hidden">
            {activePref && (
              <MunicipalityMap
                prefecture={activePref}
                municipalities={mapMunicipalities}
                selectedId={selected?.id ?? null}
                onSelect={handleSelect}
                canUseHeatmap={limit.canUseHeatmap}
              />
            )}
          </div>
        </div>

        {/* Detail panel: モバイルは全画面オーバーレイ / デスクトップは右サイドパネル */}
        <MunicipalityDetailPanel municipality={selected} onClose={closeArea} plan={plan} />

        {/* 注目町域 TOP20（Platinum・自己ゲート）。詳細パネルと同じ absolute オーバーレイで flex に干渉しない */}
        <TownHighlightsPanel
          open={highlightsOpen}
          onClose={() => setHighlightsOpen(false)}
          cityCode={selected?.city_code ?? null}
          muniName={selected?.name ?? null}
        />
      </div>
    </div>
  )
}

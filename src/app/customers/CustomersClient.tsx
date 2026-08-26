'use client'

import { useState, useEffect, useCallback, Fragment, type ReactNode } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Upload,
  Users,
  Sparkles,
  Lock,
  Loader2,
  AlertTriangle,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  Plus,
  FolderOpen,
  ChevronRight,
} from 'lucide-react'
import { Logo } from '@/components/Logo'
import { useSubscription } from '@/hooks/useSubscription'
import { canUse } from '@/lib/plans'
import { TIER_LABEL } from '@/lib/school-district-tiers'
import type { PresetChoice } from '@/lib/customer-list/preset-choice'
import {
  canDeleteList,
  describeListForDelete,
  mapDeleteError,
} from '@/lib/customer-list/delete-ui'

// ── /api/customer-lists/[id]/attack-list のレスポンス型（サーバーと対応）──
type MatchStatus = 'confirmed' | 'ambiguous' | 'out_of_scope'
interface AttackRow {
  id: string
  row_no: number
  customer_name: string | null
  address_raw: string | null
  match_status: MatchStatus
  town_name_normalized: string | null
  last_contact_at: string | null
  media: string | null
  assignee: string | null
  priority_rank: string | null
  priority_score: number | null
  priority_reason: string | null
  match_candidates: unknown
}
interface MuniAsOf {
  municipality_id: string
  municipality_name: string
  as_of: string
}
interface AttackList {
  id: string
  name: string
  row_count: number
  summary: { confirmed: number; ambiguous: number; out_of_scope: number }
  as_of_by_municipality: MuniAsOf[]
  rows: AttackRow[]
}

// ── GET /api/customer-lists/[id]/school-district-ranking（PR-C）──
//   RPC get_school_district_heatmap の返り列そのまま。★生件数は返らない（4段階の相対濃淡のみ）。
interface RankingRow {
  school_district_id: string
  school_name: string
  muni_code_5: string
  muni_name: string
  tier: number // smallint 1..4
  attribution_text: string | null
}
interface RankingResponse {
  id: string
  name: string
  school_type: string
  rows: RankingRow[]
}

// ── GET /api/customer-lists（一覧・PR-F）の1要素。org 共有の名簿メタ ──
//   preset は前回の CSV 形式選択（サーバーが column_mapping v:2 から導出）。
interface ListSummary {
  id: string
  name: string
  row_count: number
  imported_at: string
  is_owner: boolean
  preset: PresetChoice
}

// 取り込み失敗の表示情報。サーバーが返した観測性エンベロープ
//   （{ ok:false, stage, code, elapsedMs, requestId }）をそのまま提示する。
//   ⛔ サーバーが返さない情報を推測して補完しない。
interface ImportFailure {
  message: string
  http?: number
  stage?: string
  code?: string
  elapsedMs?: number
  requestId?: string
}

// 取得優先ランクバッジの配色（S/A/B/C/D の5値・D30 ライトテーマに整合）。
//   指定 hex を inline style で厳守する（Tailwind の動的クラスは purge され得るため）。
//   ⛔ これは推定ランクの見た目であり、増減率のデータ色（delta-up/down）とは無関係・不可変更。
const RANK_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  S: { bg: '#FBEDEA', color: '#B93B25', border: '#B93B25' },
  A: { bg: '#EDF2F8', color: '#1E3F66', border: '#A8BCD4' },
  B: { bg: '#F4F6F8', color: '#6B7789', border: '#D3DAE4' },
  C: { bg: '#F8FAFC', color: '#8A94A3', border: '#E3E8EF' },
  D: { bg: 'transparent', color: '#A6AEBB', border: '#E9EDF2' },
}
// 要確認（ambiguous 行の優先列に出すバッジ）。ランクではなく突合の未確定を表す warn 系。
const YOKAKUNIN_STYLE = { bg: '#FBF3DC', color: '#8A6A16', border: '#E0CC8E' }

// 校区濃淡チップ（tier 1..4）。compare/trade-area の RANK_CHIP と同じ作法（Tailwind ring クラス）。
//   ★件数は出さない・4段階の相対的な濃淡のみを表す（SD-42）。
const TIER_CHIP: Record<number, string> = {
  4: 'bg-rose-50 text-rose-700 ring-rose-200',
  3: 'bg-[#FAEEDA] text-[#854F0B] ring-amber-300',
  2: 'bg-brand-100 text-brand-700 ring-brand-300',
  1: 'bg-slate-100 text-slate-600 ring-slate-300',
}
// TIER_LABEL は @/lib/school-district-tiers から import（地図の凡例と共通の単一定義）。

// ランクバッジ。等幅・太字・中央寄せ・角丸2px・最小幅26px。
function RankBadge({ rank }: { rank: string }) {
  const s = RANK_STYLE[rank] ?? RANK_STYLE.D
  return (
    <span
      className="inline-flex items-center justify-center font-mono font-bold text-xs"
      style={{
        minWidth: 26,
        padding: '2px 4px',
        borderRadius: 2,
        backgroundColor: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
      }}
    >
      {rank}
    </span>
  )
}

// 要確認バッジ（ambiguous・優先列）。ランクの代わりに突合の未確定を示す。
function YokakuninBadge() {
  return (
    <span
      className="inline-flex items-center justify-center font-mono font-bold text-[10px]"
      style={{
        minWidth: 26,
        padding: '2px 4px',
        borderRadius: 2,
        backgroundColor: YOKAKUNIN_STYLE.bg,
        color: YOKAKUNIN_STYLE.color,
        border: `1px solid ${YOKAKUNIN_STYLE.border}`,
      }}
    >
      要確認
    </span>
  )
}

// 最終接触からの経過日数。ISO(YYYY-MM-DD…) を日付として解釈。欠損/無効は null（＝未接触）。
function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86400000)
}

// 最終接触セル。「12日前」形式。30日以上は seal 色＋太字、null は「未接触」。
function LastContact({ iso }: { iso: string | null }) {
  const d = daysSince(iso)
  if (d === null) return <span className="text-slate-400">未接触</span>
  const label = d <= 0 ? '今日' : `${d}日前`
  const stale = d >= 30
  return (
    <span
      className={stale ? 'font-bold' : undefined}
      style={stale ? { color: '#B93B25' } : undefined}
    >
      {label}
    </span>
  )
}

// 突合サマリー。名簿の総行数（row_count）と町域確定できた件数・割合を明示する。
//   row_count が 0 のときは割合を「─」にして 0 除算しない。
function MatchSummary({ rowCount, confirmed }: { rowCount: number; confirmed: number }) {
  const pct = rowCount > 0 ? ((confirmed / rowCount) * 100).toFixed(1) : null
  return (
    <div className="mb-3 text-sm text-slate-600">
      名簿 <span className="font-bold tabular-nums">{rowCount}</span> 件
      <span className="mx-2 text-slate-300">/</span>
      突合できた住所 <span className="font-bold tabular-nums">{confirmed}</span> 件
      （{pct === null ? '─' : `${pct}%`}）
    </div>
  )
}

// inferred_reason の定型末尾「… → <rank>（主因: <主因テキスト>）」から主因だけを取り出す。
//   主因テキストは内部に全角（）を含みうる（例: 短期世帯急増（供給イベントの可能性））。
//   貪欲マッチで「主因:」以降・末尾の閉じ括弧までを主因とみなす（機械生成の定型に依存）。
//   ⛔ 抽出は既存テキストの一部を切り出すだけ。無い情報を生成しない（原則1）。
function extractPrimaryCause(reason: string | null): string | null {
  if (!reason) return null
  const m = reason.match(/主因[：:]\s*([\s\S]+)）\s*$/)
  return m ? m[1].trim() : null
}

// 「町域の状況」列に表示する要約テキスト。主因が取れなければ先頭40字＋「…」にフォールバック。
//   priority_reason（=inferred_reason）が無い行（非 confirmed）は '—'（推定データ無し）。
function townSituationText(reason: string | null): string {
  const cause = extractPrimaryCause(reason)
  if (cause) return cause
  if (reason) return reason.slice(0, 40) + '…'
  return '—'
}

// 「根拠」列 — match_status から決定論的に決まる突合の確からしさ（推定スコアとは別軸の事実）。
//   confirmed=町域を一意確定 / out_of_scope=町域データ未整備の参考値 / ambiguous=候補複数で要選択。
//   ⛔ ambiguous はリンクにしない（S7 の候補解決 UI は未実装で遷移先が無い）。色は指定 hex を厳守。
const GENCHI: Record<MatchStatus, { label: string; color: string; title: string }> = {
  confirmed: {
    label: '町域実測',
    color: '#6B7789',
    title: '住所を町域に一意確定できました（実測データに突合）。',
  },
  out_of_scope: {
    label: '参考値',
    color: '#8A6A16',
    title: '対応する町域データが未整備のため優先度を付与できません（参考値）。',
  },
  ambiguous: {
    label: '住所を選択',
    color: '#8A6A16',
    title: '同名の町域が複数あり一意に特定できません（候補の絞り込みは今後対応）。',
  },
}

// 根拠チップ（突合の確からしさ）。色は指定 hex を inline で厳守（Tailwind purge の影響を受けない）。
function GenchiChip({ status }: { status: MatchStatus }) {
  const g = GENCHI[status]
  return (
    <span
      title={g.title}
      className="inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-medium"
      style={{ color: g.color, borderColor: g.color }}
    >
      {g.label}
    </span>
  )
}

// 突合基準 as_of（'YYYY-MM-DD'）→「YYYY年M月時点」。
function fmtAsOfMonth(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})/)
  if (!m) return iso
  return `${m[1]}年${Number(m[2])}月時点`
}

// 「最終取込」の表示（一覧・PR-F）。imported_at(TIMESTAMPTZ) を「YYYY/M/D HH:mm」に。
//   ⚠ これは取込成功のたびに更新される値であり初回作成日ではない（ラベルは「最終取込」・原則1）。
//   未取込（row_count=0）の分岐は呼び出し側で行う（この関数には有効な時刻だけ渡す）。
function fmtImportedAt(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const d = new Date(t)
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hh}:${mi}`
}

// 取込形式の選択（案B'・D100 相当 d）。ユーザーに CSV 形式を明示的に選ばせ、
//   ハウスドゥ形式は ?preset=hausudo を明示して送る（指紋頼みの静かな fallback を避ける）。
//   '' = 未選択（アップロード不可）/ 'hausudo' = ?preset=hausudo / 'other' = クエリ省略（自動判定）。
//   ⚠ 型は lib/customer-list/preset-choice.ts の PresetChoice を単一源として import（重複定義しない）。

// セレクタの初期値。⚠ 8/20 の打合せ結果次第で案A（既定=自動判定）へ戻す場合は
//   ここを 'other' に変えるだけでよい（1 箇所で切替）。現状は案B'＝未選択スタート。
const DEFAULT_PRESET_CHOICE: PresetChoice = ''

// 取込ルートのクエリを組み立てる。'hausudo' のときだけ ?preset=hausudo を付ける。
//   'other' はクエリ省略＝サーバー側の指紋→heuristic に委ねる既存挙動。
//   ⛔ '' は呼び出し側で送信を禁止しているため、ここには来ない。
//   ⛔ 未知の preset 値を作らない（サーバーは未知 preset を 400 で弾く・PR-C 不変）。
function importPath(listId: string, preset: PresetChoice): string {
  const base = `/api/customer-lists/${listId}/import`
  return preset === 'hausudo' ? `${base}?preset=hausudo` : base
}

export default function CustomersClient() {
  const { plan, isLoading: planLoading } = useSubscription()
  const allowed = canUse(plan, 'townAcquisitionPriority')

  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<ImportFailure | null>(null)
  const [data, setData] = useState<AttackList | null>(null)
  const [fileName, setFileName] = useState<string>('')

  // ── 一覧（PR-F）──
  //   org 共有の名簿一覧。既定ビューはこの一覧（リスト名・件数・最終取込）。
  //   lists=null は未取得（読み込み中）を表す。showCreate=true で作成ステップを開く。
  const [lists, setLists] = useState<ListSummary[] | null>(null)
  const [listsError, setListsError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [opening, setOpening] = useState(false) // 一覧から名簿を開く際のフェッチ中フラグ
  // 現在開いている名簿の作成者判定（D108 の表示上の操作可否）。
  //   ⚠ これは UI ヒントであって認可ではない。取込/削除の認可は API 403(not_list_owner) と
  //      RLS(cl_update_org / cl_delete_own) が別に担保する（原則12）。⛔ 判定ロジックには触れない。
  //   既定 true（新規作成した名簿は本人が作成者）。一覧から開くときに list.is_owner を反映する。
  const [currentIsOwner, setCurrentIsOwner] = useState(true)

  // ── 2段化（作成ステップ → アップロードステップ・PR-E）──
  //   作成で得た空リストの id を保持し、取込が失敗しても id は捨てない
  //   （row_count=0 の「取込未完了」として残す＝擬似原子性・作成途中で消さない）。
  const [listName, setListName] = useState('') // 作成ステップで入力するリスト名
  const [creating, setCreating] = useState(false)
  const [createdListId, setCreatedListId] = useState<string | null>(null)
  const [preset, setPreset] = useState<PresetChoice>(DEFAULT_PRESET_CHOICE)
  const [deleting, setDeleting] = useState(false)

  // ── 削除の確認ダイアログ（O86）──
  //   削除は必ずこのダイアログを経由する（確認ダイアログ必須・②(a) 統一）。
  //   confirmDelete=null は非表示。対象の id/name/rowCount を保持し、ダイアログに提示する。
  //   deleteError はダイアログ内に出す削除失敗の文言（一覧ビューには error カードが無いため
  //   失敗はダイアログ内で見せ、ダイアログは閉じない）。
  //   ⚠ 表示制御であって認可ではない。削除の可否は API 403/RLS が別に担保する（原則12）。
  const [confirmDelete, setConfirmDelete] = useState<{
    id: string
    name: string
    rowCount: number
  } | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // ── 表示上の絞り込み（フィルタチップ）の状態 ──
  // ⚠️ これは本人の自分のデータに対する表示上の絞り込みであり、プラン制御でも認可でもない。
  //    認可は guardFeature / API 403 / RLS の3層で別に行われている（原則12）。
  //    再フェッチはしない。すでに取得済みの data.rows をクライアント側で filter するだけ。
  const [saOnly, setSaOnly] = useState(false) // S・A ランクのみ
  const [staleOnly, setStaleOnly] = useState(false) // 30日以上未接触（null 含む）
  const [ambiguousOnly, setAmbiguousOnly] = useState(false) // 要確認（ambiguous）のみ
  const [assignee, setAssignee] = useState<string | null>(null) // 担当（null = 全員）

  // 一覧の取得（GET /api/customer-lists）。org 共有の名簿を最終取込の降順で受け取る。
  //   ⚠ setState は非同期の fetch 完了後（await 後）にのみ呼ぶ。effect 本体では同期 setState を
  //      しない（react-hooks/set-state-in-effect を新規に増やさない・O34）。
  const loadLists = useCallback(async () => {
    // ⚠ 最初の文を await にする（同期 setState を effect から呼ばない・O34 の lint 回帰防止）。
    //   状態更新はすべて await 後に行う。エラーの解除も成功パスで行う。
    try {
      const res = await fetch('/api/customer-lists')
      if (!res.ok) {
        setLists([])
        setListsError('リスト一覧の取得に失敗しました。時間をおいて再度お試しください。')
        return
      }
      const body = await res.json().catch(() => ({}))
      setLists((body.lists ?? []) as ListSummary[])
      setListsError(null)
    } catch {
      setLists([])
      setListsError('リスト一覧の取得に失敗しました。時間をおいて再度お試しください。')
    }
  }, [])

  // Platinum 認可が通ってから一覧を取得する。setState は await 後に mounted ガード付きで
  //   のみ行う（既存 TownPrioritySection と同じ idiom。effect 本体での同期 setState を避け、
  //   react-hooks/set-state-in-effect の回帰を出さない・O34）。
  useEffect(() => {
    if (!allowed) return
    let mounted = true
    async function load() {
      try {
        const res = await fetch('/api/customer-lists')
        if (!res.ok) {
          if (mounted) {
            setLists([])
            setListsError('リスト一覧の取得に失敗しました。時間をおいて再度お試しください。')
          }
          return
        }
        const body = await res.json().catch(() => ({}))
        if (mounted) {
          setLists((body.lists ?? []) as ListSummary[])
          setListsError(null)
        }
      } catch {
        if (mounted) {
          setLists([])
          setListsError('リスト一覧の取得に失敗しました。時間をおいて再度お試しください。')
        }
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [allowed])

  // 一覧から名簿を開く。取込済みは詳細（アタックリスト）を、未取込（row_count=0）は
  //   取込を完了させるためアップロードステップを開く。
  //   preset 復元（PR-F c3）: 前回取り込んだ形式を初期選択に反映する。値はサーバーが
  //   column_mapping(v:2) から導出済み（list.preset）。未取込/レガシー保存は '' となり再選択。
  async function openList(list: ListSummary) {
    setError(null)
    setFileName('')
    setPreset(list.preset)
    setCurrentIsOwner(list.is_owner) // D108: 作成者以外は操作ボタンを無効化する（表示のみ）

    if (list.row_count === 0) {
      // 未取込リスト → アップロードステップで取込を完了させる（既存の2段化 UI を再利用）。
      setListName(list.name)
      setCreatedListId(list.id)
      return
    }
    // 取込済み → 詳細（アタックリスト）を開く。
    setOpening(true)
    try {
      const res = await fetch(`/api/customer-lists/${list.id}/attack-list`)
      if (!res.ok) {
        setError({ message: 'アタックリストの取得に失敗しました。', http: res.status })
        return
      }
      setData((await res.json()) as AttackList)
    } catch {
      setError({ message: 'アタックリストの取得に失敗しました。' })
    } finally {
      setOpening(false)
    }
  }

  // 一覧へ戻る。開いていた名簿・作成/アップロードの途中状態・絞り込みを畳んで一覧を再取得する
  //   （件数・最終取込を最新化する）。
  function backToIndex() {
    setData(null)
    setCreatedListId(null)
    setShowCreate(false)
    setListName('')
    setPreset(DEFAULT_PRESET_CHOICE)
    setFileName('')
    setError(null)
    setCurrentIsOwner(true) // 一覧へ戻る＝開いている名簿なし。既定（本人）へ戻す
    resetFilters()
    loadLists()
  }

  // ① 作成ステップ: 空の名簿を1件だけ作る（POST /api/customer-lists）。
  //    行はまだ入れない。返る id を保持してアップロードステップへ進む。
  //    ⛔ 失敗しても既存 createdListId は捨てない（作成途中で消さない・擬似原子性）。
  async function handleCreate() {
    setError(null)
    setCreating(true)
    try {
      const res = await fetch('/api/customer-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: listName.trim() || '顧客名簿' }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(buildFailure(body, res.status))
        return
      }
      const created = await res.json()
      setCurrentIsOwner(true) // 新規作成＝本人が作成者（D108: 操作可）
      setCreatedListId(created.id as string)
    } catch {
      setError({
        message: 'リストの作成に失敗しました。時間をおいて再度お試しください。',
      })
    } finally {
      setCreating(false)
    }
  }

  // ② アップロードステップ: 作成済みの id へ CSV を「生バイト」で送る。
  //    ⚠ file.text() を使わない: ブラウザのテキスト化は常に UTF-8 解釈のため、
  //       cp932(Shift_JIS) の CSV はここでバイト列が失われて復元できなくなる（O44）。
  //       生バイト（ArrayBuffer）のまま送り、エンコーディング判定・cp932 フォールバックは
  //       サーバー（[id]/import → decodeCsvBytes）で行う。
  //    ⛔ レガシー /import（プリセット未適用・UTF-8固定）は初回アップロードに使わない（O53）。
  async function handleUpload(file: File) {
    // preset 未選択（'')ではボタンを無効化しているが、二重の保険としてここでも弾く。
    if (!createdListId || preset === '') return
    setError(null)
    setUploading(true)
    setFileName(file.name)
    try {
      const bytes = await file.arrayBuffer()
      const res = await fetch(importPath(createdListId, preset), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(buildFailure(body, res.status))
        return
      }
      const listRes = await fetch(
        `/api/customer-lists/${createdListId}/attack-list`,
      )
      if (!listRes.ok) {
        setError({
          message: 'アタックリストの取得に失敗しました。',
          http: listRes.status,
        })
        return
      }
      setData((await listRes.json()) as AttackList)
    } catch {
      setError({
        message: 'ファイルの読み込みに失敗しました。CSV 形式をご確認ください。',
      })
    } finally {
      setUploading(false)
    }
  }

  // 削除の確認ダイアログを開く（O86）。実際の削除は confirm 後の performDelete で行う。
  //   ⛔ どの導線（一覧の行内／未取込のアップロードステップ）からもここを必ず通す
  //      （確認ダイアログ必須・②(a) 統一）。以前の即時削除は廃止した（PM 承認済み差分）。
  function requestDelete(target: { id: string; name: string; rowCount: number }) {
    if (deleting || uploading) return
    setDeleteError(null)
    setConfirmDelete(target)
  }

  // 確認ダイアログを閉じる（キャンセル）。削除は実行しない。削除中は閉じさせない。
  function cancelDelete() {
    if (deleting) return
    setConfirmDelete(null)
    setDeleteError(null)
  }

  // 確認後に実際に削除する（O86／案①・PR-E 由来の挙動を統合）。
  //   既存の DELETE /api/customer-lists/[id]（二層封鎖済み・RLS 作成者限定）を呼ぶ。
  //   ⛔ 削除に成功したときだけ一覧へ戻して再取得する。失敗時はダイアログを閉じず、
  //      ダイアログ内に理由を出す（消せていないのに消えたと見せない）。
  async function performDelete() {
    const target = confirmDelete
    if (!target || deleting) return
    setDeleteError(null)
    setDeleting(true)
    try {
      const res = await fetch(`/api/customer-lists/${target.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const b = (body ?? {}) as Record<string, unknown>
        // 削除の失敗はダイアログ内に出す（一覧ビューには error カードが無いため）。
        setDeleteError(mapDeleteError(b.error, res.status))
        return
      }
      // 削除成功 → ダイアログを閉じ、一覧を最新化する。
      setConfirmDelete(null)
      if (data?.id === target.id || createdListId === target.id) {
        // いま開いている名簿（詳細／未取込アップロード）を消した → 一覧へ戻る（再取得込み）。
        backToIndex()
      } else {
        // 一覧の行内から消した → その場で楽観的に除去しつつ一覧を再取得する。
        setLists((cur) => (cur ? cur.filter((l) => l.id !== target.id) : cur))
        loadLists()
      }
    } catch {
      setDeleteError('リストの削除に失敗しました。時間をおいて再度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  // 既存の名簿へ「毎回全件」で再取込する（CL-17）。
  //   ⚠ file.text() を使わない: ブラウザのテキスト化は常に UTF-8 解釈のため、
  //      cp932(Shift_JIS) の CSV はここでバイト列が失われて復元できなくなる（O44）。
  //      生バイト（ArrayBuffer）のまま送り、エンコーディング判定はサーバーで行う。
  async function handleReimport(file: File) {
    if (!data) return
    const listId = data.id
    setError(null)
    setUploading(true)
    setFileName(file.name)
    try {
      const bytes = await file.arrayBuffer()
      // 再取込も初回と同じ選択形式を引き継ぐ（同一リストの形式を一貫させる）。
      const res = await fetch(importPath(listId, preset), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(buildFailure(body, res.status))
        return
      }
      const listRes = await fetch(`/api/customer-lists/${listId}/attack-list`)
      if (!listRes.ok) {
        setError({
          message: 'アタックリストの取得に失敗しました。',
          http: listRes.status,
        })
        return
      }
      setData((await listRes.json()) as AttackList)
    } catch {
      setError({
        message: 'ファイルの読み込みに失敗しました。CSV 形式をご確認ください。',
      })
    } finally {
      setUploading(false)
    }
  }

  // 担当の候補（充足している行のみ）。全行 null の名簿では担当チップを出さない。
  const assignees = Array.from(
    new Set((data?.rows ?? []).map((r) => r.assignee).filter((a): a is string => !!a)),
  )
  const ambiguousCount = data?.summary.ambiguous ?? 0
  const anyFilter = saOnly || staleOnly || ambiguousOnly || assignee !== null

  function resetFilters() {
    setSaOnly(false)
    setStaleOnly(false)
    setAmbiguousOnly(false)
    setAssignee(null)
  }

  // 取得済み配列に対するクライアント側フィルタ（AND 条件）。並び順は S6 のまま変えない。
  //   ⚠️ 表示上の絞り込みであって認可ではない（上の状態宣言のコメント／原則12 参照）。
  const filteredRows = (data?.rows ?? []).filter((r) => {
    if (saOnly && !(r.priority_rank === 'S' || r.priority_rank === 'A')) return false
    if (staleOnly) {
      const d = daysSince(r.last_contact_at)
      if (!(d === null || d >= 30)) return false
    }
    if (assignee !== null && r.assignee !== assignee) return false
    if (ambiguousOnly && r.match_status !== 'ambiguous') return false
    return true
  })

  return (
    <div className="min-h-screen bg-page-bg text-slate-900">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Logo size="sm" showWordmark={false} />
            <h1 className="flex items-center gap-2 font-bold text-base truncate">
              <Users className="w-4 h-4 text-brand-700" />
              顧客アタックリスト
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#FAEEDA] text-[#854F0B]">
                <Sparkles className="w-3 h-3" /> Platinum
              </span>
            </h1>
          </div>
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-500 hover:text-brand-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">ダッシュボードへ戻る</span>
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {planLoading ? (
          <div className="flex items-center justify-center py-24 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : !allowed ? (
          <GatedFallback />
        ) : !data && !createdListId && !showCreate ? (
          /* 既定ビュー＝一覧（PR-F）。org 共有の名簿を最終取込の降順で表示する。 */
          <ListIndex
            lists={lists}
            error={listsError}
            opening={opening}
            onNew={() => {
              setError(null)
              setListName('')
              setPreset(DEFAULT_PRESET_CHOICE)
              setShowCreate(true)
            }}
            onOpen={openList}
            onReload={loadLists}
            onRequestDelete={requestDelete}
          />
        ) : (
          <>
            {/* 一覧へ戻る導線（作成/アップロード/詳細のいずれからでも一覧に戻れる）。*/}
            <button
              type="button"
              onClick={backToIndex}
              className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-700 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              リスト一覧へ戻る
            </button>
            {/* 取り込み */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6">
              <div className="text-xs font-bold text-slate-500 mb-2">
                反響顧客名簿（CSV）を取り込む
              </div>
              <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                住所を町域に突合し、仕入れ優先度の高い順に並べ替えます。電話番号は取り込みますが保存しません。
              </p>
              {/* ステップ①：作成。名簿名を入力し、空のリストを1件作る（PR-E）。
                  ここではまだ CSV を送らない（行の投入はステップ②）。*/}
              {!data && !createdListId && (
                <div className="flex flex-col gap-3 max-w-md">
                  <label className="text-xs font-medium text-slate-600">
                    リスト名
                    <input
                      type="text"
                      value={listName}
                      onChange={(e) => setListName(e.target.value)}
                      placeholder="例：2026年8月 反響顧客"
                      maxLength={200}
                      disabled={creating}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 disabled:bg-slate-50"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={creating}
                    className="inline-flex items-center gap-2 self-start px-4 py-2 rounded-lg bg-brand-700 hover:bg-brand-500 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {creating ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Users className="w-4 h-4" />
                    )}
                    {creating ? '作成中…' : 'リストを作成'}
                  </button>
                </div>
              )}

              {/* ステップ②：アップロード。CSV 形式を明示的に選ばせ（案B'・D100 相当 d）、
                  ?preset= を明示して生バイトを送る。未選択（'')の間はファイル選択を無効化する。
                  ⛔ 形式を選ばせず指紋任せにしない（fallback:heuristic で住所が静かに壊れるのを防ぐ）。*/}
              {!data && createdListId && (
                <div className="flex flex-col gap-3 max-w-md">
                  {/* 取込未完了の明示（案①・PR-E commit4／PR-F で一覧導線が入り再到達可能に）。
                      作成済みだが row_count=0。一覧では「未取込」として表示され、ここへ戻って
                      取り込みを完了できる（もう孤児にはならない）。*/}
                  <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <div className="font-medium">
                        リスト「{listName.trim() || '顧客名簿'}
                        」は作成されましたが、CSV の取り込みが完了していません。
                      </div>
                      <div className="mt-1 text-xs text-amber-700">
                        取り込みが完了するまで、このリストは一覧で「未取込」と表示されます。取り込みを完了するか、不要なら削除してください。
                      </div>
                    </div>
                  </div>

                  {/* D108: 取込・削除は作成者のみ。作成者以外には操作ボタンを出さず注記だけ表示する
                      （認可は API 403/RLS が別に担保・原則12。⛔ その判定には触れない）。*/}
                  {currentIsOwner ? (
                    <>
                      <div className="text-xs text-slate-500">
                        取り込む CSV の形式を選び、ファイルを選択してください（何度でもやり直せます）。
                      </div>
                      <label className="text-xs font-medium text-slate-600">
                        CSV の形式
                        <select
                          value={preset}
                          onChange={(e) => setPreset(e.target.value as PresetChoice)}
                          disabled={uploading}
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 disabled:bg-slate-50"
                        >
                          <option value="">形式を選択してください</option>
                          <option value="hausudo">ハウスドゥ形式（CRM標準出力）</option>
                          <option value="other">その他のCSV（自動判定）</option>
                        </select>
                      </label>
                      <label
                        className={`inline-flex items-center gap-2 self-start px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          preset === '' || uploading
                            ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                            : 'bg-brand-700 hover:bg-brand-500 text-white cursor-pointer'
                        }`}
                      >
                        {uploading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Upload className="w-4 h-4" />
                        )}
                        {uploading ? '取り込み中…' : 'CSV を選択'}
                        <input
                          type="file"
                          accept=".csv,text/csv"
                          className="hidden"
                          disabled={preset === '' || uploading}
                          onChange={(e) => {
                            const f = e.target.files?.[0]
                            if (f) handleUpload(f)
                            e.target.value = '' // 同一ファイル再選択を許可
                          }}
                        />
                      </label>

                      {/* 削除導線（O86）。確認ダイアログを必ず経由する（②(a) 統一）。
                          実削除は performDelete → 既存 DELETE /api/customer-lists/[id]
                          （二層封鎖・RLS 作成者限定）。成功時のみ一覧へ戻す。*/}
                      <button
                        type="button"
                        onClick={() =>
                          requestDelete({
                            id: createdListId,
                            name: listName.trim() || '顧客名簿',
                            rowCount: 0,
                          })
                        }
                        disabled={deleting || uploading}
                        className="inline-flex items-center gap-2 self-start px-3 py-1.5 rounded-lg text-sm font-medium text-rose-700 ring-1 ring-rose-300 hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                        このリストを削除
                      </button>
                    </>
                  ) : (
                    <OwnerOnlyNotice />
                  )}
                </div>
              )}

              {/* 再取込（毎回全件・CL-17）。既に名簿を開いているときだけ出す。
                  顧客番号のある行は同じ行を上書きし、今回の CSV に無くなった行には
                  「消えた印」が付く。顧客番号の無い行は毎回入れ替わる。
                  D108: 再取込は作成者のみ。作成者以外は注記だけ表示する（認可は API 403 が別に担保）。*/}
              {data &&
                (currentIsOwner ? (
                  <label className="ml-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white ring-1 ring-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium cursor-pointer transition-colors">
                    <RefreshCw className="w-4 h-4" />
                    最新の名簿で再取込
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) handleReimport(f)
                        e.target.value = '' // 同一ファイル再選択を許可
                      }}
                    />
                  </label>
                ) : (
                  <OwnerOnlyNotice className="ml-2" />
                ))}
              {fileName && (
                <span className="ml-3 text-xs text-slate-500">{fileName}</span>
              )}
              {error && <ImportErrorCard failure={error} />}
            </div>

            {data && (
              <>
                {/* 突合サマリー（名簿総数・確定件数・割合）。*/}
                <MatchSummary rowCount={data.row_count} confirmed={data.summary.confirmed} />

                {/* フィルタチップ。すべて取得済み配列へのクライアント側絞り込み（AND・再フェッチなし）。
                    ⚠️ 表示上の絞り込みであり認可ではない（認可は guardFeature/API 403/RLS の3層・原則12）。*/}
                <div className="flex flex-wrap items-center gap-2 mb-5">
                  <FilterChip active={!anyFilter} onClick={resetFilters}>
                    優先度順
                  </FilterChip>
                  <FilterChip active={saOnly} onClick={() => setSaOnly((v) => !v)}>
                    S・Aのみ
                  </FilterChip>
                  <FilterChip active={staleOnly} onClick={() => setStaleOnly((v) => !v)}>
                    30日以上未接触
                  </FilterChip>
                  {assignees.length > 0 && (
                    <label
                      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium ring-1 cursor-pointer transition-colors ${
                        assignee !== null
                          ? 'bg-brand-100 text-brand-700 ring-brand-300'
                          : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      担当：
                      <select
                        value={assignee ?? ''}
                        onChange={(e) => setAssignee(e.target.value || null)}
                        className="bg-transparent outline-none cursor-pointer"
                      >
                        <option value="">全員</option>
                        {assignees.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {ambiguousCount > 0 && (
                    <FilterChip
                      active={ambiguousOnly}
                      onClick={() => setAmbiguousOnly((v) => !v)}
                    >
                      要確認 {ambiguousCount}
                    </FilterChip>
                  )}
                </div>

                {/* アタックリスト（統合・優先度順）。data.rows はサーバーで compareAttackRows
                    により確定行→要確認→参考値の順に整列済み。ここでは並べ替えず描画するだけ。
                    突合の確からしさは「根拠」列（match_status）で表し、確定/推定を混ぜない（原則1）。*/}
                <section className="mb-8">
                  <h2 className="text-sm font-bold mb-2">アタックリスト（優先度順）</h2>
                  {data.rows.length === 0 ? (
                    <EmptyNote text="表示できる行がありません。" />
                  ) : filteredRows.length === 0 ? (
                    <EmptyNote text="この絞り込みに一致する行がありません。" />
                  ) : (
                    <AttackTable rows={filteredRows} />
                  )}
                </section>

                {/* 校区別の反響の濃淡（PR-C・SD-42）。RPC get_school_district_heatmap の
                    tier(1..4)を濃淡順（RPC の ORDER BY そのまま）に描く。件数・順位番号は出さない。*/}
                <SchoolDistrictRanking listId={data.id} />

                {/* 突合基準の as_of（自治体別）。データの鮮度を明示する。 */}
                {data.as_of_by_municipality.length > 0 && (
                  <footer className="mt-8 pt-4 border-t border-slate-200 text-xs text-slate-400">
                    <span className="font-medium text-slate-500">町域データ: </span>
                    {data.as_of_by_municipality
                      .map((m) => `${m.municipality_name} ${fmtAsOfMonth(m.as_of)}`)
                      .join(' / ')}
                  </footer>
                )}
              </>
            )}
          </>
        )}
      </main>

      {/* 削除の確認ダイアログ（O86・確認ダイアログ必須）。リスト名・件数・取り消し不可を明示し、
          削除中はボタンを無効化する。失敗はダイアログ内に出し、ダイアログは閉じない。*/}
      {confirmDelete && (
        <ConfirmDeleteDialog
          target={confirmDelete}
          deleting={deleting}
          error={deleteError}
          onCancel={cancelDelete}
          onConfirm={performDelete}
        />
      )}
    </div>
  )
}

// 削除の確認ダイアログ（O86）。リスト名・件数ラベル・「この操作は取り消せません」を提示する。
//   削除中は両ボタンを無効化し、オーバーレイ／Esc での誤クローズも抑止する（実行中の取り消し防止）。
//   ⚠ これは確認 UI であって認可ではない。削除の可否は API 403/RLS が担保する（原則12）。
function ConfirmDeleteDialog({
  target,
  deleting,
  error,
  onCancel,
  onConfirm,
}: {
  target: { id: string; name: string; rowCount: number }
  deleting: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const { name, rowsLabel } = describeListForDelete(target)
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={() => {
        if (!deleting) onCancel()
      }}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-50">
            <Trash2 className="h-4 w-4 text-rose-600" />
          </div>
          <div className="min-w-0">
            <h2 id="delete-dialog-title" className="text-base font-bold text-slate-900">
              このリストを削除しますか？
            </h2>
            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex gap-2">
                <dt className="shrink-0 text-slate-500">リスト名</dt>
                <dd className="min-w-0 break-words font-medium text-slate-900">{name}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="shrink-0 text-slate-500">件数</dt>
                <dd className="tabular-nums text-slate-900">{rowsLabel}</dd>
              </div>
            </dl>
            <p className="mt-3 text-sm font-medium text-rose-700">
              この操作は取り消せません。
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {deleting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            {deleting ? '削除中…' : '削除する'}
          </button>
        </div>
      </div>
    </div>
  )
}

// 優先度つきアタックリスト表。
function AttackTable({ rows }: { rows: AttackRow[] }) {
  return (
    <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
            <th className="px-3 py-2 font-medium">優先</th>
            <th className="px-3 py-2 font-medium">顧客</th>
            <th className="px-3 py-2 font-medium">住所（町域）</th>
            <th className="px-3 py-2 font-medium">最終接触</th>
            <th className="px-3 py-2 font-medium">町域の状況</th>
            <th className="px-3 py-2 font-medium">根拠</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-slate-100 last:border-0 align-top">
              <td className="px-3 py-2">
                {r.priority_rank ? (
                  <RankBadge rank={r.priority_rank} />
                ) : r.match_status === 'ambiguous' ? (
                  <YokakuninBadge />
                ) : (
                  <span className="text-slate-300">—</span>
                )}
                {/* 取得スコア（推定）を控えめに。ソートのタイブレークにも使う値。 */}
                {r.priority_score != null && (
                  <div className="mt-0.5 text-[10px] leading-none text-slate-400 tabular-nums">
                    取得 {r.priority_score.toFixed(1)}
                  </div>
                )}
              </td>
              <td className="px-3 py-2">{r.customer_name ?? '—'}</td>
              <td className="px-3 py-2">
                <div className="text-slate-900">{r.town_name_normalized ?? '—'}</div>
                <div className="text-xs text-slate-400 truncate max-w-[240px]">
                  {r.address_raw ?? ''}
                </div>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <LastContact iso={r.last_contact_at} />
              </td>
              <td className="px-3 py-2">
                {/* 主因だけを抜き出して1〜2行に収める。セル全体の title で根拠全文を読める。
                    ランク/スコア/根拠は inferred_* であり事実ではないため「推定」を明示（原則1）。*/}
                <div
                  className="max-w-[260px]"
                  title={r.priority_reason ?? undefined}
                >
                  {r.priority_reason && (
                    <span className="mr-1 inline-block rounded px-1 text-[10px] font-medium text-slate-400 ring-1 ring-slate-200 align-middle">
                      推定
                    </span>
                  )}
                  <span className="text-xs text-slate-500 line-clamp-2 align-middle">
                    {townSituationText(r.priority_reason)}
                  </span>
                </div>
              </td>
              <td className="px-3 py-2">
                <GenchiChip status={r.match_status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// 校区別の反響の濃淡（PR-C）。名簿を開いた状態で API を叩き、tier を4段階の濃淡で描く。
//   並び順は RPC の ORDER BY(tier desc, muni_name, school_name)のまま（＝濃淡順・SD-42）。
//   ⛔ 件数の表示・件数によるソート・順位番号は一切しない（RPC は tier しか返さない）。
//   ⛔ 小学区/中学区の切替はまだ作らない（PR-B）。elementary 固定（API 既定）。
function SchoolDistrictRanking({ listId }: { listId: string }) {
  const [rows, setRows] = useState<RankingRow[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/customer-lists/${listId}/school-district-ranking`)
        if (!alive) return
        if (!res.ok) {
          setFailed(true)
          return
        }
        const json = (await res.json()) as RankingResponse
        if (alive) setRows(json.rows ?? [])
      } catch {
        if (alive) setFailed(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [listId])

  // 出典（RPC が返す attribution_text をそのまま。校区ごとに同一のことが多いので一意化）。
  const attributions =
    rows && rows.length > 0
      ? Array.from(
          new Set(rows.map((r) => r.attribution_text).filter((t): t is string => !!t)),
        )
      : []

  return (
    <section className="mb-8">
      <h2 className="text-sm font-bold mb-1">校区別の反響の濃さ</h2>
      <p className="mb-2 text-xs text-slate-400">※ 同じ濃さの中では順不同です。</p>
      {failed ? (
        <EmptyNote text="校区別の濃淡の取得に失敗しました。" />
      ) : rows === null ? (
        <div className="flex items-center gap-2 px-1 py-6 text-sm text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          読み込み中…
        </div>
      ) : rows.length === 0 ? (
        // ★「反響が無い」と断定しない（5件未満で抑止されている場合と区別できないため）。
        <EmptyNote text="該当する校区がありません。" />
      ) : (
        <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="px-3 py-2 font-medium">校区名</th>
                <th className="px-3 py-2 font-medium">濃淡</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                // 市（自治体）の見出し行を挟む。並び順（RPC の tier desc, muni_name,
                // school_name）は一切変えず、muni_name が前行から変わった位置にだけ
                // 全幅の見出し行を差し込む（列は増やさない）。
                const showMuniHeader = i === 0 || rows[i - 1].muni_name !== r.muni_name
                return (
                  <Fragment key={r.school_district_id}>
                    {showMuniHeader && (
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th
                          colSpan={2}
                          className="px-3 py-1.5 text-left text-xs font-semibold text-slate-600"
                        >
                          {r.muni_name}
                        </th>
                      </tr>
                    )}
                    <tr className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2 text-slate-900">{r.school_name}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                            TIER_CHIP[r.tier] ?? TIER_CHIP[1]
                          }`}
                        >
                          {TIER_LABEL[r.tier] ?? '—'}
                        </span>
                      </td>
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ★注記（固定文言）。5件未満の抑止と「件数は出さず4段階の相対濃淡のみ」を明示する。*/}
      {!failed && rows !== null && (
        <p className="mt-2 text-xs text-slate-400 leading-relaxed">
          直近12ヶ月に5件未満の校区は表示していません。件数は表示せず、4段階の相対的な濃淡のみを表示しています。
        </p>
      )}

      {/* ★出典（RPC が返す attribution_text をそのまま。前置きしない＝文字列自体が
          「出典：」で始まる）。*/}
      {attributions.length > 0 && (
        <p className="mt-1 text-xs text-slate-400 leading-relaxed">
          {attributions.join(' / ')}
        </p>
      )}
    </section>
  )
}

// 一覧（PR-F）。org 共有の顧客名簿を「リスト名・件数・最終取込」で並べ、
//   行を選ぶと開く（取込済み→詳細／未取込→取込を完了させるアップロード）。
//   lists=null は読み込み中。並び順（最終取込の降順）はサーバー（GET）に委ねる。
function ListIndex({
  lists,
  error,
  opening,
  onNew,
  onOpen,
  onReload,
  onRequestDelete,
}: {
  lists: ListSummary[] | null
  error: string | null
  opening: boolean
  onNew: () => void
  onOpen: (list: ListSummary) => void
  onReload: () => void
  onRequestDelete: (target: { id: string; name: string; rowCount: number }) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-sm font-bold flex items-center gap-1.5">
            <FolderOpen className="w-4 h-4 text-brand-700" />
            リスト一覧
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            組織で共有されている顧客名簿です。行を選ぶと開けます。
          </p>
        </div>
        <button
          type="button"
          onClick={onNew}
          className="inline-flex items-center gap-1.5 self-start shrink-0 px-4 py-2 rounded-lg bg-brand-700 hover:bg-brand-500 text-white text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          新規リスト作成
        </button>
      </div>

      {/* 開く処理中の薄いインジケータ（詳細フェッチ中）。*/}
      {opening && (
        <div className="mb-3 flex items-center gap-2 text-xs text-slate-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          開いています…
        </div>
      )}

      {error && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </span>
          <button
            type="button"
            onClick={onReload}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-rose-300 hover:bg-rose-100 text-xs transition-colors shrink-0"
          >
            <RefreshCw className="w-3 h-3" />
            再読み込み
          </button>
        </div>
      )}

      {lists === null ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : lists.length === 0 && !error ? (
        <div className="bg-white border border-slate-200 rounded-xl py-12 px-6 text-center">
          <FolderOpen className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500 mb-4">
            まだ顧客名簿がありません。CSV を取り込んで最初のリストを作りましょう。
          </p>
          <button
            type="button"
            onClick={onNew}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-700 hover:bg-brand-500 text-white text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            新規リスト作成
          </button>
        </div>
      ) : lists.length > 0 ? (
        <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="px-3 py-2 font-medium">リスト名</th>
                <th className="px-3 py-2 font-medium">件数</th>
                <th className="px-3 py-2 font-medium">最終取込</th>
                <th className="px-3 py-2 font-medium sr-only">操作</th>
              </tr>
            </thead>
            <tbody>
              {lists.map((l) => (
                <tr
                  key={l.id}
                  onClick={() => !opening && onOpen(l)}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer transition-colors"
                >
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-slate-900">{l.name}</span>
                    {l.row_count === 0 && (
                      <span className="ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-700 ring-1 ring-amber-200 align-middle">
                        未取込
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-700">
                    {l.row_count === 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <>{l.row_count.toLocaleString()} 件</>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">
                    {l.row_count === 0 ? (
                      <span className="text-slate-400">未取込</span>
                    ) : (
                      fmtImportedAt(l.imported_at)
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="inline-flex items-center gap-1">
                      {/* 削除（O86）。作成者本人（is_owner）のときだけ出す＝表示上のヒント。
                          認可は API 403/RLS が別に担保する（原則12）。行クリック（開く）へ
                          伝播させないため stopPropagation。実削除は確認ダイアログ経由。*/}
                      {canDeleteList(l.is_owner) && (
                        <button
                          type="button"
                          aria-label={`「${l.name}」を削除`}
                          title="このリストを削除"
                          onClick={(e) => {
                            e.stopPropagation()
                            onRequestDelete({
                              id: l.id,
                              name: l.name,
                              rowCount: l.row_count,
                            })
                          }}
                          className="inline-flex items-center justify-center p-1.5 rounded-lg text-slate-400 hover:text-rose-700 hover:bg-rose-50 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (!opening) onOpen(l)
                        }}
                        disabled={opening}
                        className="inline-flex items-center gap-1 text-brand-700 hover:text-brand-500 disabled:opacity-50 text-sm font-medium transition-colors"
                      >
                        {l.row_count === 0 ? '取込へ' : '開く'}
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

// フィルタチップ（クリック可能な表示絞り込み）。active=選択状態。
//   ⚠️ 表示上の絞り込みであり認可ではない（認可は guardFeature/API 403/RLS の3層・原則12）。
function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium ring-1 transition-colors ${
        active
          ? 'bg-brand-700 text-white ring-brand-700'
          : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  )
}

// D108 表示: 作成者以外は操作できないことを明示する（表示のみ）。
//   ⚠ これは UI の無効化・注記であって認可ではない。取込は API 403(not_list_owner)、
//      削除は RLS(cl_delete_own) が別に拒否する（原則12）。⛔ その判定には触れない。
function OwnerOnlyNotice({ className = '' }: { className?: string }) {
  return (
    <div
      className={`inline-flex items-center gap-2 self-start rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 ${className}`}
    >
      <Lock className="w-4 h-4 shrink-0" />
      作成者のみ操作できます
    </div>
  )
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl py-8 px-6 text-center text-sm text-slate-400">
      {text}
    </div>
  )
}

function GatedFallback() {
  return (
    <div className="bg-white border border-slate-200 rounded-xl py-16 px-6 text-center max-w-md mx-auto">
      <Lock className="w-10 h-10 text-brand-700 mx-auto mb-4" />
      <h2 className="text-lg font-bold mb-2">顧客アタックリストは Platinum 限定です</h2>
      <p className="text-slate-500 text-sm mb-6 leading-relaxed">
        自社の反響顧客名簿を町域の仕入れ優先度で並べ替える機能です。Platinum プランでご利用いただけます。
      </p>
      <div className="flex items-center justify-center gap-3">
        <Link
          href="/pricing"
          className="px-4 py-2 rounded-lg bg-brand-700 hover:bg-brand-500 text-white text-sm font-medium transition-colors"
        >
          プランを見る
        </Link>
        <Link
          href="/dashboard"
          className="px-4 py-2 rounded-lg bg-white hover:bg-brand-100 border border-[#C7D6E4] text-brand-700 text-sm transition-colors"
        >
          ダッシュボードへ戻る
        </Link>
      </div>
    </div>
  )
}

// 取り込み失敗レスポンスを表示情報へ変換する。
//   観測性エンベロープ（stage/code を含む）はそのまま診断表示に載せ、
//   既知の入力エラー（CSV 形式など）は従来どおり具体的な案内を出す。
//   ⛔ サーバーが返さない項目は補完しない。
function buildFailure(body: unknown, status: number): ImportFailure {
  const b = (body ?? {}) as Record<string, unknown>
  if (typeof b.stage === 'string' && typeof b.code === 'string') {
    return {
      message: '取り込みに失敗しました。',
      http: status,
      stage: b.stage,
      code: b.code,
      elapsedMs: typeof b.elapsedMs === 'number' ? b.elapsedMs : undefined,
      requestId: typeof b.requestId === 'string' ? b.requestId : undefined,
    }
  }
  return { message: mapError(b.error, status), http: status }
}

// 取り込みエラーカード。段階/コード/所要時間/HTTP を提示し、問い合わせIDをコピー可能にする。
function ImportErrorCard({ failure }: { failure: ImportFailure }) {
  const [copied, setCopied] = useState(false)

  const parts: string[] = []
  if (failure.http != null) parts.push(`HTTP ${failure.http}`)
  if (failure.stage) parts.push(`段階: ${failure.stage}`)
  if (failure.code) parts.push(`コード: ${failure.code}`)
  if (failure.elapsedMs != null) {
    parts.push(`${(failure.elapsedMs / 1000).toFixed(1)}秒`)
  }

  async function copyRequestId() {
    if (!failure.requestId) return
    try {
      await navigator.clipboard.writeText(failure.requestId)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard 非対応環境では何もしない（表示済みの ID を手動コピーできる）。
    }
  }

  return (
    <div className="mt-3 flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div>
          {failure.message}
          {parts.length > 0 && (
            <span className="text-rose-600/80">（{parts.join('・')}）</span>
          )}
        </div>
        {failure.requestId && (
          <div className="mt-1 flex items-center gap-2 text-xs text-rose-600/90">
            <span className="font-mono truncate">
              問い合わせID: {failure.requestId}
            </span>
            <button
              type="button"
              onClick={copyRequestId}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-rose-300 hover:bg-rose-100 transition-colors shrink-0"
            >
              {copied ? (
                <Check className="w-3 h-3" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
              {copied ? 'コピーしました' : 'コピー'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// import API の既知エラーコードを日本語メッセージへ（入力検証など）。
function mapError(code: unknown, status: number): string {
  switch (code) {
    case 'address_column_not_found':
      return '住所の列を検出できませんでした。ヘッダに「住所」を含む列があるかご確認ください。'
    case 'too_many_rows':
      return `行数が上限（5,000行）を超えています。分割してお試しください。`
    case 'empty_csv':
    case 'no_data_rows':
      return 'データ行が見つかりませんでした。CSV の内容をご確認ください。'
    case 'invalid_json':
      return 'ファイルの形式が不正です。'
    default:
      if (status === 403) return 'この機能は Platinum プラン限定です。'
      if (status === 401) return 'ログインが必要です。'
      return '取り込みに失敗しました。'
  }
}

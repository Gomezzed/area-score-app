'use client'

import { useState, type ReactNode } from 'react'
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
} from 'lucide-react'
import { Logo } from '@/components/Logo'
import { useSubscription } from '@/hooks/useSubscription'
import { canUse } from '@/lib/plans'

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

// 取込形式の選択（案B'・D100 相当 d）。ユーザーに CSV 形式を明示的に選ばせ、
//   ハウスドゥ形式は ?preset=hausudo を明示して送る（指紋頼みの静かな fallback を避ける）。
//   '' = 未選択（アップロード不可）/ 'hausudo' = ?preset=hausudo / 'other' = クエリ省略（自動判定）。
type PresetChoice = '' | 'hausudo' | 'other'

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

  // ── 2段化（作成ステップ → アップロードステップ・PR-E）──
  //   作成で得た空リストの id を保持し、取込が失敗しても id は捨てない
  //   （row_count=0 の「取込未完了」として残す＝擬似原子性・作成途中で消さない）。
  const [listName, setListName] = useState('') // 作成ステップで入力するリスト名
  const [creating, setCreating] = useState(false)
  const [createdListId, setCreatedListId] = useState<string | null>(null)
  const [preset, setPreset] = useState<PresetChoice>(DEFAULT_PRESET_CHOICE)
  const [deleting, setDeleting] = useState(false)

  // ── 表示上の絞り込み（フィルタチップ）の状態 ──
  // ⚠️ これは本人の自分のデータに対する表示上の絞り込みであり、プラン制御でも認可でもない。
  //    認可は guardFeature / API 403 / RLS の3層で別に行われている（原則12）。
  //    再フェッチはしない。すでに取得済みの data.rows をクライアント側で filter するだけ。
  const [saOnly, setSaOnly] = useState(false) // S・A ランクのみ
  const [staleOnly, setStaleOnly] = useState(false) // 30日以上未接触（null 含む）
  const [ambiguousOnly, setAmbiguousOnly] = useState(false) // 要確認（ambiguous）のみ
  const [assignee, setAssignee] = useState<string | null>(null) // 担当（null = 全員）

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

  // 取込未完了（row_count=0）のリストを削除する（案①・PR-E commit4）。
  //   既存の DELETE /api/customer-lists/[id]（二層封鎖済み・RLS 作成者限定）を呼ぶ。
  //   ⛔ 削除に成功したときだけ state を初期化して作成ステップへ戻す。失敗時は state を
  //      消さない（消せていないのに消えたと見せない）。
  async function handleDelete() {
    if (!createdListId || deleting || uploading) return
    setError(null)
    setDeleting(true)
    try {
      const res = await fetch(`/api/customer-lists/${createdListId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(buildFailure(body, res.status))
        return
      }
      // 削除成功 → 作成ステップへ戻す。
      setCreatedListId(null)
      setListName('')
      setPreset(DEFAULT_PRESET_CHOICE)
      setFileName('')
      setError(null)
    } catch {
      setError({
        message: 'リストの削除に失敗しました。時間をおいて再度お試しください。',
      })
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
        ) : (
          <>
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
                  {/* 取込未完了の明示＋離脱警告（案①・PR-E commit4）。作成済みだが row_count=0。
                      ⚠ 離脱すると UI からこのリストへ再到達できない（一覧導線は PR-F）。
                         黙って孤児にしないため、離脱警告は必ず出す（省略しない）。*/}
                  <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <div className="font-medium">
                        リスト「{listName.trim() || '顧客名簿'}
                        」は作成されましたが、CSV の取り込みが完了していません。
                      </div>
                      <div className="mt-1 text-xs text-amber-700">
                        このページを離れると、このリストを再び開くことはできません。取り込みを完了するか、削除してください。
                      </div>
                    </div>
                  </div>

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

                  {/* 削除導線。既存 DELETE /api/customer-lists/[id]（二層封鎖・RLS 作成者限定）
                      を呼ぶ。成功時のみ作成ステップへ戻す（handleDelete 内で state 初期化）。*/}
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting || uploading}
                    className="inline-flex items-center gap-2 self-start px-3 py-1.5 rounded-lg text-sm font-medium text-rose-700 ring-1 ring-rose-300 hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {deleting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                    {deleting ? '削除中…' : 'このリストを削除'}
                  </button>
                </div>
              )}

              {/* 再取込（毎回全件・CL-17）。既に名簿を開いているときだけ出す。
                  顧客番号のある行は同じ行を上書きし、今回の CSV に無くなった行には
                  「消えた印」が付く。顧客番号の無い行は毎回入れ替わる。*/}
              {data && (
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
              )}
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

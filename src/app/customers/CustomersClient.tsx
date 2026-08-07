'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Upload,
  Users,
  Sparkles,
  Lock,
  Loader2,
  AlertTriangle,
  Info,
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

const RANK_CHIP: Record<string, string> = {
  S: 'bg-rose-50 text-rose-700 ring-rose-200',
  A: 'bg-[#FAEEDA] text-[#854F0B] ring-amber-300',
  B: 'bg-brand-100 text-brand-700 ring-brand-300',
  C: 'bg-slate-100 text-slate-600 ring-slate-300',
  D: 'bg-slate-100 text-slate-600 ring-slate-300',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}/${m[2]}/${m[3]}` : '—'
}

// 突合基準 as_of（'YYYY-MM-DD'）→「YYYY年M月時点」。
function fmtAsOfMonth(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})/)
  if (!m) return iso
  return `${m[1]}年${Number(m[2])}月時点`
}

export default function CustomersClient() {
  const { plan, isLoading: planLoading } = useSubscription()
  const allowed = canUse(plan, 'townAcquisitionPriority')

  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<AttackList | null>(null)
  const [fileName, setFileName] = useState<string>('')

  async function handleFile(file: File) {
    setError(null)
    setUploading(true)
    setData(null)
    setFileName(file.name)
    try {
      const csv = await file.text()
      const importRes = await fetch('/api/customer-lists/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, name: file.name }),
      })
      if (!importRes.ok) {
        const body = await importRes.json().catch(() => ({}))
        setError(mapError(body?.error, importRes.status))
        return
      }
      const imported = await importRes.json()
      const listRes = await fetch(
        `/api/customer-lists/${imported.id}/attack-list`,
      )
      if (!listRes.ok) {
        setError('アタックリストの取得に失敗しました。')
        return
      }
      setData((await listRes.json()) as AttackList)
    } catch {
      setError('ファイルの読み込みに失敗しました。CSV 形式をご確認ください。')
    } finally {
      setUploading(false)
    }
  }

  const confirmedRows = data?.rows.filter((r) => r.match_status === 'confirmed') ?? []
  const ambiguousRows = data?.rows.filter((r) => r.match_status === 'ambiguous') ?? []
  const outRows = data?.rows.filter((r) => r.match_status === 'out_of_scope') ?? []

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
              <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-700 hover:bg-brand-500 text-white text-sm font-medium cursor-pointer transition-colors">
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
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleFile(f)
                    e.target.value = '' // 同一ファイル再選択を許可
                  }}
                />
              </label>
              {fileName && (
                <span className="ml-3 text-xs text-slate-500">{fileName}</span>
              )}
              {error && (
                <div className="mt-3 flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            {data && (
              <>
                {/* サマリ */}
                <div className="flex flex-wrap gap-3 mb-6 text-sm">
                  <SummaryChip label="取り込み" value={data.row_count} tone="slate" />
                  <SummaryChip label="町域確定" value={data.summary.confirmed} tone="brand" />
                  <SummaryChip label="要確認" value={data.summary.ambiguous} tone="amber" />
                  <SummaryChip label="参考値" value={data.summary.out_of_scope} tone="slate" />
                </div>

                {/* アタックリスト（confirmed・優先度順） */}
                <section className="mb-8">
                  <h2 className="text-sm font-bold mb-2">アタックリスト（町域確定・優先度順）</h2>
                  {confirmedRows.length === 0 ? (
                    <EmptyNote text="町域を確定できた行がありません。" />
                  ) : (
                    <AttackTable rows={confirmedRows} />
                  )}
                </section>

                {/* 要確認（ambiguous・分離表示） */}
                {ambiguousRows.length > 0 && (
                  <section className="mb-8">
                    <h2 className="flex items-center gap-1.5 text-sm font-bold mb-2 text-[#854F0B]">
                      <AlertTriangle className="w-4 h-4" />
                      要確認（町域候補が複数）{ambiguousRows.length} 件
                    </h2>
                    <p className="text-xs text-slate-400 mb-2">
                      同名の町域が複数あり一意に特定できませんでした。候補の絞り込みは今後のステップで対応します。
                    </p>
                    <SimpleTable rows={ambiguousRows} />
                  </section>
                )}

                {/* 参考値（out_of_scope・分離表示） */}
                {outRows.length > 0 && (
                  <section className="mb-8">
                    <h2 className="flex items-center gap-1.5 text-sm font-bold mb-2 text-slate-500">
                      <Info className="w-4 h-4" />
                      参考値（町域データ未整備）{outRows.length} 件
                    </h2>
                    <p className="text-xs text-slate-400 mb-2">
                      対応する町域データが未整備のため、優先度を付与できません（参考値）。
                    </p>
                    <SimpleTable rows={outRows} />
                  </section>
                )}

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
            <th className="px-3 py-2 font-medium">根拠</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-slate-100 last:border-0 align-top">
              <td className="px-3 py-2">
                {r.priority_rank ? (
                  <span
                    className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-bold ring-1 ${
                      RANK_CHIP[r.priority_rank] ?? RANK_CHIP.D
                    }`}
                  >
                    {r.priority_rank}
                  </span>
                ) : (
                  <span className="text-slate-300">—</span>
                )}
              </td>
              <td className="px-3 py-2">{r.customer_name ?? '—'}</td>
              <td className="px-3 py-2">
                <div className="text-slate-900">{r.town_name_normalized ?? '—'}</div>
                <div className="text-xs text-slate-400 truncate max-w-[240px]">
                  {r.address_raw ?? ''}
                </div>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.last_contact_at)}</td>
              <td className="px-3 py-2">
                <span className="text-xs text-slate-500 leading-relaxed">
                  {r.priority_reason ?? '—'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// 要確認 / 参考値の簡易表（優先度なし）。
function SimpleTable({ rows }: { rows: AttackRow[] }) {
  return (
    <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
            <th className="px-3 py-2 font-medium">顧客</th>
            <th className="px-3 py-2 font-medium">住所</th>
            <th className="px-3 py-2 font-medium">最終接触</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-slate-100 last:border-0">
              <td className="px-3 py-2">{r.customer_name ?? '—'}</td>
              <td className="px-3 py-2 text-slate-500">{r.address_raw ?? '—'}</td>
              <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.last_contact_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SummaryChip({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'slate' | 'brand' | 'amber'
}) {
  const toneCls =
    tone === 'brand'
      ? 'bg-brand-100 text-brand-700 ring-brand-300'
      : tone === 'amber'
        ? 'bg-[#FAEEDA] text-[#854F0B] ring-amber-300'
        : 'bg-slate-100 text-slate-600 ring-slate-300'
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg ring-1 ${toneCls}`}>
      <span className="text-xs font-medium">{label}</span>
      <span className="font-bold tabular-nums">{value}</span>
    </span>
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

// import API のエラーコードを日本語メッセージへ。
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
      return '取り込みに失敗しました。時間をおいて再度お試しください。'
  }
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import { FileSpreadsheet, Loader2, Unplug } from 'lucide-react'

// 機能フラグ（既定 false）。'true' のときのみボタンを描画する。
//   NEXT_PUBLIC_ なのでビルド時にクライアントへインライン展開される。
const SHEETS_EXPORT_ENABLED =
  process.env.NEXT_PUBLIC_FEATURE_SHEETS_EXPORT === 'true'

type Toast = { kind: 'success' | 'error'; message: string } | null

interface Props {
  // 出力対象の都道府県 name_en（例 'hokkaido'）。サーバーがこの値で再取得する。
  prefectureNameEn: string | undefined
  // データ未取得・0 件時などボタンを無効化する。
  disabled?: boolean
}

// Google Sheets 出力ボタン（Standard 以上・フラグ ON 時のみ描画）。
//   未接続: クリックで /api/integrations/google/authorize へ遷移
//   接続済: クリックで POST /api/export/sheets → 成功で新規タブに URL
//   reconnect_required: 「Google に再接続」導線
export function SheetsExportButton({ prefectureNameEn, disabled }: Props) {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<Toast>(null)

  const showToast = useCallback((t: Toast) => {
    setToast(t)
    if (t) {
      window.setTimeout(() => setToast(null), 5000)
    }
  }, [])

  // 接続状態の取得。
  useEffect(() => {
    if (!SHEETS_EXPORT_ENABLED) return
    let cancelled = false
    fetch('/api/integrations/google/status')
      .then((r) => (r.ok ? r.json() : { connected: false }))
      .then((d) => {
        if (!cancelled) setConnected(!!d.connected)
      })
      .catch(() => {
        if (!cancelled) setConnected(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // /dashboard?sheets=connected|error を拾ってトースト表示後、クエリを除去。
  //   useSearchParams は Suspense 制約があるため window.location を直接読む。
  useEffect(() => {
    if (!SHEETS_EXPORT_ENABLED) return
    const params = new URLSearchParams(window.location.search)
    const s = params.get('sheets')
    if (!s) return

    // クエリを即時除去（URL という外部状態の同期。setState ではない）。
    params.delete('sheets')
    const qs = params.toString()
    window.history.replaceState(
      null,
      '',
      window.location.pathname + (qs ? `?${qs}` : ''),
    )

    // setState は effect 同期実行の外（マイクロタスク）へ逃がす。
    queueMicrotask(() => {
      if (s === 'connected') {
        setConnected(true)
        showToast({ kind: 'success', message: 'Google 連携が完了しました。' })
      } else if (s === 'error') {
        showToast({
          kind: 'error',
          message: 'Google 連携に失敗しました。もう一度お試しください。',
        })
      }
    })
  }, [showToast])

  const goAuthorize = useCallback(() => {
    // 302 で Google に飛ぶため通常のフルナビゲーション。
    window.location.href = '/api/integrations/google/authorize'
  }, [])

  const handleClick = useCallback(async () => {
    if (busy) return
    if (connected !== true) {
      goAuthorize()
      return
    }
    if (!prefectureNameEn) return

    setBusy(true)
    try {
      const res = await fetch('/api/export/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefecture_name_en: prefectureNameEn }),
      })
      const data = await res.json().catch(() => ({}))

      if (res.ok && data.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer')
        showToast({
          kind: 'success',
          message: 'スプレッドシートを作成しました。新しいタブで開きます。',
        })
      } else if (res.status === 409 && data.error === 'reconnect_required') {
        setConnected(false)
        showToast({
          kind: 'error',
          message: 'Google への再接続が必要です。ボタンから再接続してください。',
        })
      } else if (res.status === 403) {
        showToast({
          kind: 'error',
          message: 'Sheets 出力は Standard プラン以上で利用できます。',
        })
      } else {
        showToast({
          kind: 'error',
          message: 'Sheets 出力に失敗しました。時間をおいて再度お試しください。',
        })
      }
    } catch {
      showToast({ kind: 'error', message: '通信エラーが発生しました。' })
    } finally {
      setBusy(false)
    }
  }, [busy, connected, prefectureNameEn, goAuthorize, showToast])

  if (!SHEETS_EXPORT_ENABLED) return null

  const isConnect = connected !== true
  const label = isConnect ? 'Sheets連携' : 'Sheetsに出力'
  const title = isConnect
    ? 'Google と連携して Sheets 出力を有効化します'
    : '表示中のエリアを Google スプレッドシートに出力します'

  return (
    <>
      <button
        onClick={handleClick}
        disabled={busy || (!isConnect && (disabled || !prefectureNameEn))}
        className="flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 min-w-[44px] sm:min-w-0 px-2 sm:px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
        title={title}
      >
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : isConnect ? (
          <Unplug className="w-4 h-4" />
        ) : (
          <FileSpreadsheet className="w-4 h-4" />
        )}
        <span className="hidden sm:inline">{label}</span>
      </button>

      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-lg px-4 py-3 text-sm text-white shadow-lg ${
            toast.kind === 'success' ? 'bg-emerald-600' : 'bg-red-600'
          }`}
          role="status"
        >
          {toast.message}
        </div>
      )}
    </>
  )
}

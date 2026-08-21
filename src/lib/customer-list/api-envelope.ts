// ============================================================
// 取込系 Route Handler の観測性エンベロープ（D49 B'案）— 共有ヘルパー。
//   クライアントへ返すのは stage / code / elapsedMs / requestId（＋段階別 timings）のみ。
//   ⛔ detail / Supabase 生メッセージ / SQL / スキーマ名は一切返さない。
//      それらは Sentry にだけ送る。
//
//   ※ v0（POST /api/customer-lists/import）は PR-F c5 で撤去済み（410 Gone スタブ）。
//     現行の取込は [id]/import のみで、こちらの共有版を使う。
// ============================================================

import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { CustomerListDbError } from './server.ts'

// 段階識別子はルートごとに違うため型引数で受ける。
export type Timings<S extends string> = Partial<Record<S, number>>

// 経過ミリ秒（整数）。performance.now() は node ランタイムのグローバル。
export function elapsedMsSince(start: number): number {
  return Math.round(performance.now() - start)
}

// 全レスポンスに付与する追跡ヘッダ（サポート時に requestId を突合できる）。
export function requestIdHeader(requestId: string): Record<string, string> {
  return { 'x-request-id': requestId }
}

// 失敗レスポンス（観測性エンベロープ）。
export function failEnvelope<S extends string>(
  status: number,
  stage: S,
  code: string,
  requestId: string,
  timings: Timings<S>,
  startedAt: number,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      stage,
      code,
      elapsedMs: elapsedMsSince(startedAt),
      requestId,
      timings,
    },
    { status, headers: requestIdHeader(requestId) },
  )
}

// PostgrestError / CustomerListDbError から SQLSTATE 等を取り出す（Sentry 専用）。
export function pgFieldsOf(error: unknown): {
  code?: string
  message?: string
  details?: string
  hint?: string
} | null {
  if (error instanceof CustomerListDbError) return error.pg
  if (error && typeof error === 'object' && 'message' in error) {
    const e = error as {
      code?: string
      message?: string
      details?: string
      hint?: string
    }
    return { code: e.code, message: e.message, details: e.details, hint: e.hint }
  }
  return null
}

// 例外を Sentry にだけ送る（握りつぶし禁止・全 catch から必ず呼ぶ）。
//   ⚠ Fluid Compute はインスタンスを並行リクエストで再利用するため、
//      グローバル setTag だとタグが他リクエストへ漏れる。withScope でイベント単位に閉じる。
export function reportImportError<S extends string>(
  error: unknown,
  ctx: { requestId: string; stage: S; timings: Timings<S> },
): void {
  const pg = pgFieldsOf(error)
  Sentry.withScope((scope) => {
    scope.setTag('import_stage', ctx.stage)
    if (pg?.code) scope.setTag('pg_code', pg.code)
    scope.setContext('import', {
      requestId: ctx.requestId,
      stage: ctx.stage,
      timings: ctx.timings,
      pgMessage: pg?.message ?? null,
      pgHint: pg?.hint ?? null,
      pgDetails: pg?.details ?? null,
    })
    Sentry.captureException(error)
  })
}

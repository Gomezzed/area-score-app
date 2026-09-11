// PR-BM-10b: org版3ルート専用の no-store ヘルパ（裁定-bm-J）。
//   既存 customer-lists/[id]/buyer-match/cards/route.ts L15-19 と同一実装。
//   既存 cards/rows の複製2箇所は据え置き、新設3ルートのみがここから import する。
//   ⚠ next/server に依存するため node --test 対象外（単体テスト不要・裁定-bm-J）。
import { NextResponse } from 'next/server'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const

export function jsonNoStore(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS })
}

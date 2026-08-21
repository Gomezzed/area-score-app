import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

// レガシー取込 API（v0）の撤去（PR-F c5）。
//   このルート（POST /api/customer-lists/import）は「プリセット未適用・UTF-8 固定」の
//   初回一括取込で、UI からは既に未使用（O53）。cp932 の静かな文字化けや preset 不適用の
//   誤突合を避けるため、現行の取込は必ず [id]/import（作成→アップロードの2段化・PR-E）を使う。
//
//   ⚠ 物理 404 にはしない：以前存在したことを 410 Gone で明示し、正しい導線（/customers の
//      一覧→新規作成／再取込）へ案内する（決定・PR-F）。⛔ ファイルは残す（410 スタブ）。
//   ⛔ 認可・突合・取込ロジックはここには持たせない（撤去済み）。判定は現行ルートが担う。

// 撤去済みを表す共通の 410 応答。新しい取込導線を JSON で案内する。
function gone() {
  return NextResponse.json(
    {
      error: 'gone',
      message:
        'この取込 API は廃止されました。/customers の一覧から「新規リスト作成」または各リストの再取込をご利用ください。',
      use: '/customers',
    },
    { status: 410 },
  )
}

// 旧 API は POST のみを公開していた。撤去後は POST/GET いずれも 410 を返す
//   （誤って到達しても 405 ではなく「廃止」を明示するため）。
export function POST() {
  return gone()
}

export function GET() {
  return gone()
}

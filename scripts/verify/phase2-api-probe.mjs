// ============================================================
// Phase 2 API 層プローブ（読み取り専用・検証用）
//
//   目的: TU1 を各プランに切り替えた状態で、guardFeature 系 6 API を叩き、
//         API 層（401/403/200）がプラン別に正しくゲートすることを実測する。
//
//   認証は Cookie 専用（Route Handler は Authorization: Bearer を受理しない）。
//   そのため Cookie を env PHASE2_COOKIE から受け取る。
//   ※ PHASE2_COOKIE の値はファイルに書かない・ログに出さない・コミットしない。
//     取得手順（Application > Cookies は使わない。@supabase/ssr の auth-token は
//     チャンク分割 sb-...-auth-token.0 / .1 され結合ミスを誘発するため）:
//       1) 本番 https://area-score-app.vercel.app に TU1 でログイン（シークレットウィンドウ）
//       2) DevTools > Network > /dashboard 等・任意のリクエストを選択
//       3) Request Headers の「Cookie:」行の値を丸ごとコピー
//       4) export PHASE2_COOKIE='<貼り付け>'（先頭スペース付きで実行し履歴に残さない）
//
//   合格判定（重要）:
//   - 期待プランに含まれる → 200 のみ合格
//   - 期待プランに含まれない → 403 かつ body.plan == 実際のTU1プラン のとき合格
//   - 401 は「未認証＝テスト無効」。★必ず FAIL 扱い★（Cookie 失効の可能性）。
//     401 を合格に数えると Phase 2 全体が無意味になる（唯一の致命的失敗モード）。
//   - access_token は約1時間で失効。401 検出時は Cookie 再取得を促す。
//
//   plan は JWT クレームではなく DB 参照（current_user_plan()）なので、
//   同じ Cookie を 4 プランすべてで使い回せる（再ログイン不要）。
//
//   ★検証対象は本番のみ★ Phase 2 の証明対象は「契約3社が触る本番」。
//     localhost の 403 はローカルツリー＋.env.local の挙動にすぎず本番を証明しない。
//     そのため BASE_URL は必須（既定 localhost を置くと偽陽性を生むため置かない）。
//
//   実行:
//     export PHASE2_COOKIE='...'   # 履歴に残さないよう注意（先頭スペース等）
//     BASE_URL=https://area-score-app.vercel.app EXPECT_PLAN=platinum node scripts/verify/phase2-api-probe.mjs
//   env:
//     PHASE2_COOKIE (必須), EXPECT_PLAN (platinum|standard|starter|free 必須),
//     BASE_URL (必須・本番URLを指定)
// ============================================================

const cookie = process.env.PHASE2_COOKIE
const expectPlan = process.env.EXPECT_PLAN
const base = process.env.BASE_URL

function fail(msg) {
  console.error(`[phase2-api-probe] ${msg}`)
  process.exit(1)
}
// BASE_URL 必須化: 既定 localhost は「うっかりローカルを検証して合格と誤認する」偽陽性の
// 失敗モードなので置かない。未指定は即エラー。
if (!base) fail('BASE_URL is required (use the production URL)')
if (!cookie) fail('PHASE2_COOKIE が未設定です（TU1 ログイン済みブラウザの Cookie を export してください。値はログに出しません）')
const PLANS = ['platinum', 'standard', 'starter', 'free']
if (!expectPlan || !PLANS.includes(expectPlan)) {
  fail(`EXPECT_PLAN は ${PLANS.join('|')} のいずれかを指定してください（現在の TU1 プランを渡す）`)
}

// サンプル値（神戸市東灘区/灘区・データ実在）。
const HIGASHINADA = '34e174b9-c810-4f1e-8a32-7d7ce70534a6'
const NADA = '3949eb25-b42c-42e6-9adb-9dd7c679309a'

// 検証対象 6 API と、その API を 200 で通せる最小プラン集合（guardFeature に対応）。
const ENDPOINTS = [
  { key: 'towns',      path: `/api/towns?muni_code=281018`,                    allow: ['platinum'] },
  { key: 'highlights', path: `/api/towns/highlights?muni_code=281018`,         allow: ['platinum'] },
  { key: 'compare',    path: `/api/compare?a=${HIGASHINADA}&b=${NADA}`,        allow: ['platinum'] },
  { key: 'trade-area', path: `/api/trade-area?municipality_id=${HIGASHINADA}`, allow: ['platinum'] },
  { key: 'market',     path: `/api/market-metrics?muni_code=28101`,            allow: ['standard', 'platinum'] },
  { key: 'stations',   path: `/api/stations?municipality_id=${HIGASHINADA}`,   allow: ['standard', 'platinum'] },
]

const nowISO = new Date().toISOString()

async function main() {
  const results = []
  let sawUnauthorized = false

  for (const ep of ENDPOINTS) {
    const url = base + ep.path
    let status = null
    let body = null
    try {
      const res = await fetch(url, { headers: { cookie }, redirect: 'manual' })
      status = res.status
      body = await res.json().catch(() => null)
    } catch (e) {
      results.push({ key: ep.key, url: ep.path, status: 'FETCH_ERR', verdict: 'FAIL(fetch)', detail: e?.message })
      continue
    }

    const entitled = ep.allow.includes(expectPlan)
    let verdict
    if (status === 401) {
      // ★致命的失敗モード★ 未認証はテスト無効。合格に数えない。
      sawUnauthorized = true
      verdict = 'FAIL(401-unauthenticated:INVALID-TEST)'
    } else if (entitled) {
      verdict = status === 200 ? 'PASS(allowed:200)' : `FAIL(allowed-but-${status})`
    } else {
      // 非対象プラン: 403 かつ body.plan が実プランと一致で合格。
      const planMatches = body && body.plan === expectPlan
      if (status === 403 && planMatches) verdict = 'PASS(blocked:403)'
      else if (status === 403) verdict = `FAIL(403-but-plan=${body?.plan ?? 'null'}!=${expectPlan})`
      else verdict = `FAIL(expected-403-got-${status})`
    }

    results.push({
      key: ep.key,
      url: ep.path,
      status,
      // body は plan と error のみ保持（データ本体・トークンは出さない）。
      bodyPlan: body?.plan ?? null,
      bodyError: body?.error ?? null,
      expectPlan,
      entitled,
      verdict,
    })
  }

  // トップレベルに baseUrl と expectPlan を明示（どこを・どの期待値で検証したかを証跡に残す）。
  console.log(JSON.stringify({ baseUrl: base, expectPlan, timestamp: nowISO, results }, null, 2))

  if (sawUnauthorized) {
    console.error(
      '\n[phase2-api-probe] ⚠ 401 を検出しました＝Cookie が未設定/失効の可能性（access_token は約1時間で失効）。' +
      '\n  → TU1 ブラウザで再ログインし、DevTools から Cookie を取り直して PHASE2_COOKIE を再設定してください。' +
      '\n  この実行の結果はテスト無効として扱ってください。',
    )
    process.exit(2)
  }
}

main().catch((e) => fail(`未捕捉エラー: ${e?.message ?? String(e)}`))

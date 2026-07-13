// ============================================================
// Phase 2 RLS 実測プローブ（読み取り専用・検証用）
//
//   目的: TU1 を各プランに切り替えた状態で、anon キー＋TU1 セッションから
//         6 テーブルを直接 SELECT し、RLS がプラン別に行を封鎖することを
//         「API 層を迂回して」実測で証明する。
//
//   重要な設計:
//   - anon キーのみ使用。service_role キーは絶対に使わない
//     （service_role は RLS をバイパスするため、使うと検証が無意味になる）。
//   - RLS による SELECT 拒否は「エラー」ではなく count=0 / 空配列で返る。
//     したがって error の有無ではなく count で封鎖成否を判定する。
//   - プランは JWT クレームではなく DB 参照（current_user_plan()）なので、
//     プラン切替後の再ログインは不要。まず current_user_plan() を出力し、
//     その後に各テーブルを照会する。
//
//   実行:
//     source ~/.area-score-secrets && node scripts/verify/phase2-rls-probe.mjs
//   必要な env:
//     NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, TU1_EMAIL, TU1_PASSWORD
//   ※ 値はスクリプトに埋め込まない。access_token / パスワード / キーは一切出力しない。
// ============================================================
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const email = process.env.TU1_EMAIL
const password = process.env.TU1_PASSWORD

// 本番プロジェクト以外での実行を拒否する（BASE_URL 必須化と対称）。
// source 後のシェルに .env.local や別プロジェクトの値が残っていると、本番でない DB の
// RLS を検証して「合格」と誤報告するため。
const REQUIRED_REF = 'bstohiamtnlgcjulgedy'

function fail(msg) {
  console.error(`[phase2-rls-probe] ${msg}`)
  process.exit(1)
}

// 【1】本番プロジェクトのアサート（最優先）。
if (!url || !url.includes(REQUIRED_REF)) {
  fail(`Refusing to run: SUPABASE_URL must point at production project ${REQUIRED_REF}`)
}
if (!anon) fail('NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定です')
if (!email || !password) fail('TU1_EMAIL / TU1_PASSWORD が未設定です（~/.area-score-secrets を source したか確認）')

// 【2】anon キーであることのアサート（service_role だと RLS をバイパスし、
//      全プランで全件が返って「free でも Platinum 専用データが取れる」偽陽性の重大レポートを生む）。
//      キーの値そのものは出力しない。role 文字列のみで判定する。
function assertAnonKey(key) {
  if (key.startsWith('eyJ')) {
    const parts = key.split('.')
    if (parts.length !== 3) fail('Refusing to run: ANON_KEY is a malformed JWT')
    let role
    try {
      role = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role
    } catch {
      fail('Refusing to run: cannot decode ANON_KEY payload')
    }
    if (role === 'service_role') fail('Refusing to run: service_role key bypasses RLS')
    if (role !== 'anon') fail(`Refusing to run: expected role 'anon', got '${role ?? 'unknown'}'`)
  } else if (key.startsWith('sb_publishable_')) {
    // 新形式の publishable キー。RLS 適用対象なので OK。
  } else if (key.startsWith('sb_secret_')) {
    fail('Refusing to run: sb_secret_ key bypasses RLS')
  } else {
    fail('Refusing to run: unrecognized ANON_KEY format (expected anon JWT or sb_publishable_)')
  }
}
assertAnonKey(anon)

// 証跡用の project ref（URL から抽出。一致は上でアサート済み）。
const projectRef = (url.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] || REQUIRED_REF

// anon キーのクライアント（RLS 被適用）。service_role は使わない。
const sb = createClient(url, anon, { auth: { persistSession: false } })

// 検証対象テーブルと期待エンタイトルメント。
//   gate: このテーブルを SELECT できる最小プラン集合（RLS ポリシーに対応）。
//   open: RLS USING(true) で全ログインユーザーが全件取得可（H1 の証跡）。expected は概数。
const TABLES = [
  { key: 'P',  table: 'town_monthly_metrics', gate: ['platinum'] },
  { key: 'S1', table: 'market_metrics',       gate: ['standard', 'platinum'] },
  { key: 'S2', table: 'national_metrics',     gate: ['standard', 'platinum'] },
  { key: 'S3', table: 'stations',             gate: ['standard', 'platinum'] },
  { key: 'O1', table: 'municipalities',       open: true, expected: 1916 },
  { key: 'O2', table: 'population_stats',     open: true, expected: 5736 },
]

const nowISO = new Date().toISOString()

async function main() {
  const { error: signInErr } = await sb.auth.signInWithPassword({ email, password })
  if (signInErr) fail(`signInWithPassword 失敗: ${signInErr.message}`)

  // DB が認識しているプランをまず取得（テーブル照会より前に実行）。
  const { data: planData, error: planErr } = await sb.rpc('current_user_plan')
  const plan = planErr ? null : planData
  if (planErr) console.error(`[phase2-rls-probe] current_user_plan RPC 警告: ${planErr.message}`)

  const results = []
  for (const t of TABLES) {
    const { count, error } = await sb
      .from(t.table)
      .select('*', { count: 'exact', head: true })
    const actual = typeof count === 'number' ? count : null

    let verdict
    if (t.open) {
      // 全員閲覧可（H1）。count が概数どおり返れば OPEN。
      verdict = actual !== null && actual > 0 ? 'OPEN(all-can-read/H1)' : 'UNEXPECTED'
    } else {
      const entitled = plan ? t.gate.includes(plan) : false
      if (entitled) {
        verdict = actual !== null && actual > 0 ? 'PASS(allowed:rows>0)' : 'FAIL(allowed-but-0)'
      } else {
        // RLS 封鎖の期待。count=0 なら成功（error 有無では判定しない）。
        verdict = actual === 0 ? 'PASS(blocked:0)' : `FAIL(leak:count=${actual})`
      }
    }

    results.push({
      key: t.key,
      table: t.table,
      gate: t.open ? 'open(true)' : t.gate.join('|'),
      count: actual,
      // RLS 拒否は error=null かつ count=0 が正常系。参考のため error メッセージのみ保持（値は無害）。
      error: error ? error.message : null,
      verdict,
    })
  }

  // 【3】どのプロジェクトを検証したかを証跡に刻む。
  console.log(JSON.stringify({ supabaseUrl: url, projectRef, plan, timestamp: nowISO, results }, null, 2))

  await sb.auth.signOut()
}

main().catch((e) => fail(`未捕捉エラー: ${e?.message ?? String(e)}`))

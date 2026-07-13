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

function fail(msg) {
  console.error(`[phase2-rls-probe] ${msg}`)
  process.exit(1)
}
if (!url || !anon) fail('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定です')
if (!email || !password) fail('TU1_EMAIL / TU1_PASSWORD が未設定です（~/.area-score-secrets を source したか確認）')

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

  console.log(JSON.stringify({ plan, timestamp: nowISO, results }, null, 2))

  await sb.auth.signOut()
}

main().catch((e) => fail(`未捕捉エラー: ${e?.message ?? String(e)}`))

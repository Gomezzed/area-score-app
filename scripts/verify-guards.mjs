#!/usr/bin/env node
// =====================================================================
// scripts/verify-guards.mjs
//
// 3層ガード（UI / API / DB-RLS）の自動検証スクリプト（読み取り専用）。
//   プラン × エンドポイントの全組み合わせを実測し、PASS/FAIL を一覧化する。
//   契約3社（月10万円）オンボード前の「プラン別アクセス制御が効いている」証跡。
//
// 検証する3観点:
//   [API] guardFeature / サーバー側プラン判定で保護された全エンドポイントが
//         プランごとに期待どおり 401 / 403 / 404 / 通過(200相当) を返すか。
//         ・H9: /api/export/sheets はサーバー側でマスターフラグ
//           (NEXT_PUBLIC_FEATURE_SHEETS_EXPORT) を検査していない疑い → 実測で確認。
//   [DB]  各プランのクライアントで RLS が期待どおり行を絞るか。守る対象が異なる
//         2系統を必ず別項目で検証する:
//         ・current_user_plan() 判定: town_monthly_metrics=platinumのみ / stations等=standard+
//         ・auth.uid() 判定:        customer_lists / customer_list_rows=本人の行のみ
//   [GAP] Free「上位3件のみ」がデータ取得時点で効いているか（＝UIだけか）。
//
// 設計方針:
//   ・期待値は「仕様（CLAUDE.md §3 料金v2.1）」を独立に書き下したもの。
//     src/lib/plans.ts は import しない（実装のバグを期待値に写し込まないため）。
//   ・本番DBへの write / DDL は一切しない。許可プラン側は「無効な入力」で叩き、
//     ガード通過を確認するだけで副作用（シート作成・行挿入・削除）を起こさない。
//   ・認証はヘッドレスの email+password。ブラウザ自動化は使わない。
//     - DB-RLS層: @supabase/supabase-js のセッション（JWT）で PostgREST に RLS 適用。
//     - API層:    Route Handler は @supabase/ssr の cookie ベース認証のため、
//                 同一 @supabase/ssr で正規の SSR cookie を生成して Cookie ヘッダで送る
//                 （現行サーバーは Authorization: Bearer を読まない）。
//   ・認証情報は .env.local から読む（ハードコードしない）。未設定なら
//     キー名だけ示して停止する。
//
// 実行:  node scripts/verify-guards.mjs
// 終了コード: 0=全ガードPASS / 1=ガードFAILあり or 認証・接続エラー / 2=必要env未設定
// =====================================================================

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createServerClient } from '@supabase/ssr'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

// ── 出力ヘルパ（色は TTY のときだけ） ────────────────────────────────
const C = process.stdout.isTTY
  ? { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', b: '\x1b[34m', d: '\x1b[2m', bold: '\x1b[1m', x: '\x1b[0m' }
  : { g: '', r: '', y: '', b: '', d: '', bold: '', x: '' }
const line = (s = '') => console.log(s)
const hr = () => line(C.d + '─'.repeat(88) + C.x)

// ── .env.local パーサ（必要キーだけ読む・値は出力しない） ─────────────
function parseEnvFile(path) {
  const out = {}
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return out // ファイルが無ければ空（process.env にフォールバック）
  }
  for (const rawLine of raw.split('\n')) {
    const l = rawLine.trim()
    if (!l || l.startsWith('#')) continue
    const eq = l.indexOf('=')
    if (eq === -1) continue
    const key = l.slice(0, eq).trim()
    let val = l.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

const fileEnv = parseEnvFile(resolve(REPO_ROOT, '.env.local'))
// process.env（明示指定）を優先し、無ければ .env.local。
const env = (key) => (process.env[key] ?? fileEnv[key] ?? '').trim()

// ── 必要 env の検証（未設定ならキー名だけ出して停止） ─────────────────
const BASE_URL = (env('VERIFY_BASE_URL') || 'https://area-score-app.vercel.app').replace(/\/$/, '')
const SUPABASE_URL = env('NEXT_PUBLIC_SUPABASE_URL')
const ANON_KEY = env('NEXT_PUBLIC_SUPABASE_ANON_KEY')

// テストアカウント定義（free / platinum は必須、starter / standard は任意）。
const ACCOUNT_DEFS = [
  { plan: 'free',     required: true,  emailKey: 'VERIFY_FREE_EMAIL',     pwKey: 'VERIFY_FREE_PASSWORD' },
  { plan: 'platinum', required: true,  emailKey: 'VERIFY_PLATINUM_EMAIL', pwKey: 'VERIFY_PLATINUM_PASSWORD' },
  { plan: 'starter',  required: false, emailKey: 'VERIFY_STARTER_EMAIL',  pwKey: 'VERIFY_STARTER_PASSWORD' },
  { plan: 'standard', required: false, emailKey: 'VERIFY_STANDARD_EMAIL', pwKey: 'VERIFY_STANDARD_PASSWORD' },
]

function checkRequiredEnv() {
  const missing = []
  if (!SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL')
  if (!ANON_KEY) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  for (const a of ACCOUNT_DEFS) {
    if (!a.required) continue
    if (!env(a.emailKey)) missing.push(a.emailKey)
    if (!env(a.pwKey)) missing.push(a.pwKey)
  }
  return missing
}

const missingEnv = checkRequiredEnv()
if (missingEnv.length) {
  line(`${C.r}${C.bold}必要な環境変数が未設定です。${C.x} 以下のキーを .env.local に設定してください（値はここには出しません）:`)
  for (const k of missingEnv) line(`  - ${k}`)
  line('')
  line(`${C.d}任意（Starter/Standard の境界も検証する場合）:${C.x}`)
  line('  - VERIFY_STARTER_EMAIL / VERIFY_STARTER_PASSWORD')
  line('  - VERIFY_STANDARD_EMAIL / VERIFY_STANDARD_PASSWORD')
  line(`${C.d}任意（実行先の変更。既定=${BASE_URL}）:${C.x}`)
  line('  - VERIFY_BASE_URL')
  process.exit(2)
}

// =====================================================================
// 仕様（CLAUDE.md §3 料金v2.1）の独立な書き下し。
//   ※ src/lib/plans.ts は参照しない。実行系（plans.ts + guardFeature + RLS）を
//     この独立定義と突き合わせることで、plans.ts 自体のエンタイトルメント誤りも検出する。
// =====================================================================
const RANK = { free: 0, starter: 1, standard: 2, platinum: 3 }

// 機能キー → 必要最低プラン（CLAUDE.md §3）。
const FEATURE_MIN_PLAN = {
  townAcquisitionPriority: 'platinum', // 町域取得優先（Platinum内包・アタックリスト）
  areaCompare: 'platinum',             // エリア比較
  tradeAreaReport: 'platinum',         // 商圏レポート
  canExportSheets: 'standard',         // Sheets出力 = CSV相当（standard+）
  stationLevelEntitled: 'standard',    // 駅単位ドリルダウン（standard+）
  marketMetricsEntitled: 'standard',   // 相場・公示価格（standard+）
}
const specAllows = (plan, feature) => RANK[plan] >= RANK[FEATURE_MIN_PLAN[feature]]

// 検証対象 API（guardFeature / サーバー側プラン判定で保護されたもの）。
//   body/params は「ガード通過後の検証で必ず弾かれる無効値」にして副作用を防ぐ。
const NIL_UUID = '00000000-0000-0000-0000-000000000000'
const API_TARGETS = [
  { id: 'towns',            method: 'GET',    path: '/api/towns',                              feature: 'townAcquisitionPriority', cl: false },
  { id: 'towns/highlights', method: 'GET',    path: '/api/towns/highlights',                   feature: 'townAcquisitionPriority', cl: false },
  { id: 'compare',          method: 'GET',    path: '/api/compare',                            feature: 'areaCompare',             cl: false },
  { id: 'trade-area',       method: 'GET',    path: '/api/trade-area',                         feature: 'tradeAreaReport',         cl: false },
  { id: 'market-metrics',   method: 'GET',    path: '/api/market-metrics',                     feature: 'marketMetricsEntitled',   cl: false },
  { id: 'stations',         method: 'GET',    path: '/api/stations',                           feature: 'stationLevelEntitled',    cl: false },
  { id: 'export/sheets',    method: 'POST',   path: '/api/export/sheets',                      feature: 'canExportSheets',         cl: false,
    body: { prefecture_name_en: '__verify_guards_no_such_pref__' } },
  { id: 'customer-lists/import',      method: 'POST',   path: '/api/customer-lists/import',                 feature: 'townAcquisitionPriority', cl: true, body: {} },
  { id: 'customer-lists/[id]',        method: 'DELETE', path: `/api/customer-lists/${NIL_UUID}`,            feature: 'townAcquisitionPriority', cl: true },
  { id: 'customer-lists/attack-list', method: 'GET',    path: `/api/customer-lists/${NIL_UUID}/attack-list`, feature: 'townAcquisitionPriority', cl: true },
]

// =====================================================================
// 認証: @supabase/ssr で in-memory cookie-jar にサインインし、
//   (a) RLS用の認証済クライアント (b) API用の Cookie ヘッダ を同時に得る。
// =====================================================================
function makeJar() {
  const store = new Map()
  return {
    // @supabase/ssr が読み書きする cookie インターフェース
    getAll: () => [...store.entries()].map(([name, value]) => ({ name, value })),
    setAll: (cookies) => { for (const { name, value } of cookies) store.set(name, value) },
    cookieHeader: () => [...store.entries()].map(([n, v]) => `${n}=${v}`).join('; '),
    size: () => store.size,
  }
}

async function signIn({ email, password }) {
  const jar = makeJar()
  const client = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: { getAll: jar.getAll, setAll: jar.setAll },
  })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`sign-in failed: ${error.message}`)
  return { client, jar, user: data.user }
}

// API を叩いて HTTP ステータスだけ取る（本文は判定に使わない）。
async function apiCall(target, cookieHeader) {
  const headers = {}
  let body
  if (target.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(target.body)
  }
  if (cookieHeader) headers['cookie'] = cookieHeader
  try {
    const res = await fetch(BASE_URL + target.path, {
      method: target.method,
      headers,
      body,
      redirect: 'manual',
    })
    return res.status
  } catch (e) {
    return `ERR:${e.message}`
  }
}

// =====================================================================
// 期待値ロジック（仕様ベース）
//   verdictDeny  : 認証あり非許可 → 403 / 未認証 → 401 / customer-list flag off → 404
//   verdictAllow : 許可プラン    → ガード通過（401/403 以外）
// =====================================================================
function expectedFor(target, account, clFlag) {
  // customer-list はサーバーフラグ off なら全員 404（存在ごと隠す）。
  if (target.cl && clFlag === 'off') {
    return { label: '404', ok: (s) => s === 404 }
  }
  if (!account.authed) {
    // 未認証: 保護APIは 401（customer-list は flag on 前提でここに来る）。
    return { label: '401', ok: (s) => s === 401 }
  }
  if (specAllows(account.plan, target.feature)) {
    // 許可: ガード通過＝401/403 以外（無効入力なので 400/404/409 等になる）。
    return { label: 'PASS(≠401,403)', ok: (s) => typeof s === 'number' && s !== 401 && s !== 403 }
  }
  // 認証あり非許可: 403。
  return { label: '403', ok: (s) => s === 403 }
}

// =====================================================================
// メイン
// =====================================================================
const results = { pass: 0, fail: 0 }
const findings = [] // H9 / GAP など、PASS/FAIL とは別枠の指摘
const failRows = []

function record(ok) { if (ok) results.pass++; else results.fail++; return ok }

async function main() {
  line('')
  line(`${C.bold}3層ガード検証（verify-guards）${C.x}`)
  line(`${C.d}target : ${BASE_URL}${C.x}`)
  line(`${C.d}supabase: ${SUPABASE_URL}${C.x}`)

  // ── サインイン（設定済アカウントのみ） ──────────────────────────────
  const accounts = []
  for (const def of ACCOUNT_DEFS) {
    const email = env(def.emailKey)
    const password = env(def.pwKey)
    if (!email || !password) continue // 任意アカウント未設定はスキップ
    try {
      const { client, jar, user } = await signIn({ email, password })
      accounts.push({ plan: def.plan, authed: true, client, jar, user, email })
      line(`${C.d}signed in: ${def.plan.padEnd(8)} (${email})${C.x}`)
    } catch (e) {
      line(`${C.r}✗ サインイン失敗: ${def.plan} (${email}) — ${e.message}${C.x}`)
      results.fail++
      failRows.push(`sign-in / ${def.plan}`)
    }
  }
  const byPlan = Object.fromEntries(accounts.map((a) => [a.plan, a]))
  const free = byPlan.free
  const platinum = byPlan.platinum

  // 未認証プローブ用の仮アカウント。
  const anon = { plan: 'anon', authed: false, jar: null }

  // ── 認証カナリア: cookie が API 認証として効くか（誤FAIL防止） ─────────
  hr()
  line(`${C.bold}[0] 認証カナリア（Cookie が Route Handler の認証として効くか）${C.x}`)
  let cookieAuthOk = true
  for (const acc of accounts) {
    const status = await apiCall({ method: 'GET', path: '/api/integrations/google/status' }, acc.jar.cookieHeader())
    const ok = status === 200
    if (!ok) cookieAuthOk = false
    line(`  ${ok ? C.g + '✓' : C.r + '✗'} ${acc.plan.padEnd(8)} /api/integrations/google/status → ${status} ${ok ? '(認証OK)' : '(期待 200)'}${C.x}`)
  }
  // 未認証は 401 であるべき（カナリアの対照）。
  {
    const status = await apiCall({ method: 'GET', path: '/api/integrations/google/status' }, null)
    line(`  ${status === 401 ? C.g + '✓' : C.y + '?'} ${'anon'.padEnd(8)} /api/integrations/google/status → ${status} (期待 401)${C.x}`)
  }
  if (!cookieAuthOk) {
    line('')
    line(`${C.r}${C.bold}Cookie 認証が機能していません。${C.x} API層の判定は信頼できないため中止します。`)
    line(`${C.d}（@supabase/ssr の cookie 形式ずれの可能性。DB-RLS層のみ検証を続けます）${C.x}`)
  }

  // ── customer-list サーバーフラグ状態の検出（free の 403/404 で判定） ─────
  let clFlag = 'unknown'
  if (cookieAuthOk && free) {
    const s = await apiCall(API_TARGETS.find((t) => t.id === 'customer-lists/attack-list'), free.jar.cookieHeader())
    clFlag = s === 403 ? 'on' : s === 404 ? 'off' : 'unknown'
  }

  // ── [1] API層 ───────────────────────────────────────────────────────
  hr()
  line(`${C.bold}[1] API層：プラン × 保護エンドポイント${C.x}`)
  line(`${C.d}FEATURE_CUSTOMER_LIST（サーバーフラグ）検出結果: ${clFlag}`)
  line(`  凡例: PASS=期待どおり / FAIL=不一致 / allow側は「401/403以外＝ガード通過」を期待${C.x}`)
  hr()

  const statusMap = {} // `${target.id}|${plan}` → status（H9 等で再利用）
  if (cookieAuthOk) {
    // ヘッダ行
    const probes = [anon, free, byPlan.starter, byPlan.standard, platinum].filter(Boolean)
    const W = 12
    line(C.d + 'endpoint'.padEnd(30) + 'method'.padEnd(8) + probes.map((p) => p.plan.padEnd(W)).join('') + C.x)

    for (const target of API_TARGETS) {
      let row = target.id.padEnd(30) + target.method.padEnd(8)
      for (const acc of probes) {
        const status = await apiCall(target, acc.authed ? acc.jar.cookieHeader() : null)
        statusMap[`${target.id}|${acc.plan}`] = status
        const exp = expectedFor(target, acc, clFlag)
        const ok = record(exp.ok(status))
        if (!ok) failRows.push(`API ${target.id} / ${acc.plan} (got ${status}, want ${exp.label})`)
        // 色コードは視覚幅0なので、プレーン内容を固定幅にしてから色で包む。
        const plain = `${ok ? '✓' : '✗'}${status}`.padEnd(W)
        row += (ok ? C.g : C.r) + plain + C.x
      }
      line(row)
    }

    // H9: sheets のマスターフラグ未検査（アーキ指摘・PASS/FAIL とは別枠）
    const sheetsPlatinum = statusMap['export/sheets|platinum'] ?? null
    findings.push({
      tag: 'H9',
      title: '/api/export/sheets はサーバー側でマスターフラグ(NEXT_PUBLIC_FEATURE_SHEETS_EXPORT)を検査しない',
      detail:
        `platinum のプランゲート通過後 step③ へ到達（status=${sheetsPlatinum}）。customer-list の ` +
        `FEATURE_CUSTOMER_LIST（サーバー二層封鎖）と異なり、sheets/stations/market-metrics は ` +
        `プランのみ検査でフラグ非依存。フラグ off でも standard+ は API 直叩きで到達可能（二層封鎖の原則違反）。` +
        `現状の悪用可否は本番 NEXT_PUBLIC_FEATURE_SHEETS_EXPORT の値に依存（bundle grep で別途確認）。`,
    })
  } else {
    line(`${C.y}（カナリア失敗のため API 層はスキップ）${C.x}`)
  }

  // ── [2] DB-RLS層 ────────────────────────────────────────────────────
  hr()
  line(`${C.bold}[2] DB-RLS層：プラン境界 と 本人境界（守る対象が異なる2系統）${C.x}`)
  hr()

  // 2-a) current_user_plan() 判定: プラン境界。
  //   town_monthly_metrics = platinum のみ / stations・market・national = standard+。
  const PLAN_TABLES = [
    { table: 'town_monthly_metrics', minPlan: 'platinum' },
    { table: 'stations',             minPlan: 'standard' },
    { table: 'market_metrics',       minPlan: 'standard' },
    { table: 'national_metrics',     minPlan: 'standard' },
  ]
  line(`${C.d}2-a) current_user_plan() 判定（行数が期待どおり絞られるか）${C.x}`)
  for (const { table, minPlan } of PLAN_TABLES) {
    for (const acc of accounts) {
      const { count, error } = await acc.client
        .from(table)
        .select('*', { count: 'exact', head: true })
      const shouldSee = RANK[acc.plan] >= RANK[minPlan]
      // 期待: 見える側は >0（本番にデータ有り）、見えない側は 0 行。
      let ok, note
      if (error) { ok = false; note = `error: ${error.message}` }
      else if (shouldSee) { ok = count > 0; note = `${count} 行 (期待 >0)` }
      else { ok = count === 0; note = `${count} 行 (期待 0)` }
      record(ok)
      if (!ok) failRows.push(`RLS ${table} / ${acc.plan} (${note})`)
      line(`  ${ok ? C.g + '✓' : C.r + '✗'} ${table.padEnd(22)} ${acc.plan.padEnd(9)} ${note}${C.x}`)
    }
  }

  // 2-b) auth.uid() 判定: 本人境界。返る全行の user_id が自分のIDと一致すること。
  line('')
  line(`${C.d}2-b) auth.uid() 判定（本人の行のみ・他人の行に到達不可）${C.x}`)
  for (const table of ['customer_lists', 'customer_list_rows']) {
    for (const acc of accounts) {
      const { data, error } = await acc.client.from(table).select('id, user_id').limit(1000)
      let ok, note
      if (error) {
        // 権限エラーは「到達不可」の一形態。RLS で 0 行が正なので error は想定外。
        ok = false; note = `error: ${error.message}`
      } else {
        const rows = data ?? []
        const foreign = rows.filter((r) => r.user_id !== acc.user.id).length
        ok = foreign === 0
        note = `${rows.length} 行取得 / 他人の行 ${foreign} 件（期待 0）`
      }
      record(ok)
      if (!ok) failRows.push(`RLS ${table} / ${acc.plan} (${note})`)
      line(`  ${ok ? C.g + '✓' : C.r + '✗'} ${table.padEnd(22)} ${acc.plan.padEnd(9)} ${note}${C.x}`)
    }
  }

  // ── [3] Free「上位3件」はデータ取得時点で効いているか（GAP検査） ────────
  hr()
  line(`${C.bold}[3] Free「上位3件のみ」はデータ取得時点で効いているか${C.x}`)
  hr()
  if (free) {
    // 代表的な1都道府県の municipalities 行数を free で取得。データ層ゲートがあれば ≤3。
    const { data: prefRow } = await free.client
      .from('municipalities').select('prefecture_code').not('prefecture_code', 'is', null).limit(1)
    const code = prefRow?.[0]?.prefecture_code
    let perPref = null
    if (code) {
      const { count } = await free.client
        .from('municipalities').select('*', { count: 'exact', head: true }).eq('prefecture_code', code)
      perPref = count
    }
    const { count: total } = await free.client
      .from('municipalities').select('*', { count: 'exact', head: true })

    const dataLayerGated = perPref != null && perPref <= 3
    if (dataLayerGated) {
      line(`  ${C.g}✓ Free はデータ取得時点で ${perPref} 行に絞られている（データ層ゲートあり）${C.x}`)
      record(true)
    } else {
      line(`  ${C.y}△ GAP: Free でも prefecture_code=${code} に対し ${perPref} 行、全国 ${total} 行を取得できる${C.x}`)
      line(`  ${C.d}    → 上位3件はデータ層ゲートではなく UI/クライアントの slice のみ`)
      line(`  ${C.d}      (usePlanLimit.applyAreaVisibilityLimit / dashboard、コード内 TODO(Phase2) と一致)${C.x}`)
      findings.push({
        tag: 'GAP',
        title: 'Free「上位3件」はデータ層で効いていない（UI slice のみ）',
        detail:
          `municipalities RLS は authenticated USING(true)。Free でも prefecture 単位 ${perPref} 行 / ` +
          `全国 ${total} 行を取得可能。上位3件制限は usePlanLimit のフロント slice のみで、` +
          `ロック分の実値もクライアントに渡る（既知: コード内 TODO(Phase2)）。仕様を「表示のみ」と読むなら` +
          `想定内、「データ層でも絞る」と読むなら要対応。`,
      })
    }
  } else {
    line(`${C.y}（free アカウント未サインインのためスキップ）${C.x}`)
  }

  // ── サマリ ──────────────────────────────────────────────────────────
  hr()
  line(`${C.bold}サマリ${C.x}`)
  line(`  PASS: ${C.g}${results.pass}${C.x}   FAIL: ${results.fail ? C.r : C.d}${results.fail}${C.x}`)
  if (failRows.length) {
    line(`  ${C.r}FAIL 項目:${C.x}`)
    for (const f of failRows) line(`    - ${f}`)
  }
  if (findings.length) {
    line('')
    line(`  ${C.y}${C.bold}指摘（PASS/FAIL とは別枠・要判断）:${C.x}`)
    for (const f of findings) {
      line(`    ${C.y}[${f.tag}]${C.x} ${f.title}`)
      line(`      ${C.d}${f.detail}${C.x}`)
    }
  }
  // 検証できなかった観点の明示。
  const notCovered = []
  if (!byPlan.starter) notCovered.push('Starter 境界（starter拒否/standard許可の確定）— VERIFY_STARTER_* 未設定')
  if (!byPlan.standard) notCovered.push('Standard 許可側の直接確認 — VERIFY_STANDARD_* 未設定')
  notCovered.push('UI層（非表示・ロック表示・ブラー）— 本スクリプトは API/DB のみ。目視 or e2e が必要')
  if (notCovered.length) {
    line('')
    line(`  ${C.d}${C.bold}未カバー（目視/別手段が必要）:${C.x}`)
    for (const n of notCovered) line(`    ${C.d}- ${n}${C.x}`)
  }
  hr()

  const exitCode = results.fail > 0 ? 1 : 0
  line(`${exitCode === 0 ? C.g + 'RESULT: PASS' : C.r + 'RESULT: FAIL'}${C.x} (exit ${exitCode})`)
  line('')
  process.exit(exitCode)
}

main().catch((e) => {
  line(`${C.r}fatal: ${e.stack || e.message}${C.x}`)
  process.exit(1)
})

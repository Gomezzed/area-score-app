#!/usr/bin/env node
// =====================================================================
// scripts/gen-demo-buyer-match.mjs
//
// 購入希望マッチのデモ用 顧客名簿 CSV 生成器（裁定85・A2-1）。
//   岡崎市(23202)・架空の顧客 105 行を 3 名簿（A/B/C）に分けて生成し、
//   ハウスドゥ形式（174 列）で本番の取込 UI に通せる CSV を書き出す。
//
// 設計方針（PM 確定・A2-0 調査を前提）:
//   - 依存ゼロ（Node 組み込みのみ）。verify-guards.mjs の前例に倣う。
//   - ⛔ 生成 CSV はリポジトリに置かない。--out はリポジトリ外を指すこと。
//        --out が本リポジトリ配下を指したら 1 バイトも書かずにエラー終了する。
//   - ⛔ ヘッダ文字列はここに書き下さない。fixture v1 の 1 行目を実行時に読み、
//        逐語で使う（174 列）。列位置はヘッダ名で解決し、A2-0 実測の 1 始まり
//        列番号と一致することを起動時に assert する（不一致なら停止＝S-1）。
//   - 乱数は固定シード（既定 20260913）。同じ引数なら同じ CSV が出る。
//   - 文字コード UTF-8(BOM 付き)・CRLF。カンマ/引用符/改行を含む値は "" で囲む。
//
// ⚠ このスクリプトは src/ を一切参照しない（取込経路には触れない＝Tier 2）。
//    label_ja・列番号・住所仕様は A2-0 の調査値をここに定数として持つ（実コード由来）。
// =====================================================================
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createHash } from 'node:crypto'

const DEFAULT_SEED = 20260913

// ── 引数解析（--out <dir> 必須 / --seed <int> 既定 20260913）──────────
function parseArgs(argv) {
  const args = { out: null, seed: DEFAULT_SEED }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') {
      args.out = argv[++i] ?? null
    } else if (a === '--seed') {
      const n = Number(argv[++i])
      if (!Number.isInteger(n)) fatal('--seed は整数で指定してください')
      args.seed = n
    } else {
      fatal(`未知の引数: ${a}`)
    }
  }
  if (!args.out) fatal('--out <dir> は必須です（出力先ディレクトリ）')
  return args
}

function fatal(msg) {
  console.error(`[gen-demo-buyer-match] ERROR: ${msg}`)
  process.exit(1)
}

// ── 固定シード PRNG（mulberry32）。同じシードで同じ列を消費すれば再現する。──
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// =====================================================================
// A2-0 実測の固定値（実コード由来。ここが「正」と食い違えば起動時 assert で停止）
// =====================================================================
// ヘッダ名 → 期待する 1 始まり列番号。
const EXPECTED_COL = {
  顧客番号: 1,
  顧客名: 4,
  店舗営業担当者: 9,
  顧客種別: 11,
  受付日: 18,
  都道府県: 41,
  市区: 42,
  住所: 43,
  マッチング物件種別: 96,
  マッチング土地面積下限: 109,
  マッチング土地面積上限: 110,
  マッチング専有面積下限: 111,
  マッチング専有面積上限: 112,
  マッチング小学校: 115,
  物件種別: 150,
}
// 反響媒体は同名 2 列（15/16）。1 個目（nth=0）＝ 15 を使う。
const EXPECTED_MEDIA_COL = 15

// property_types の 6 値（label_ja）。今回のデモは住宅系 5 種のみ使う（事業用は未使用）。
const TYPE_LABEL = {
  new_detached: '新築戸建',
  used_detached: '中古戸建',
  new_condo: '新築マンション',
  used_condo: '中古マンション',
  land: '土地',
  commercial: '事業用',
}
// 価格 6 組（列97〜108）のヘッダ名（種別ごとに下限/上限）。期待列番号も持つ。
const PRICE_HEADERS = {
  new_detached: ['マッチング物件価格下限新築戸建', 'マッチング物件価格上限新築戸建', 97, 98],
  used_detached: ['マッチング物件価格下限中古戸建', 'マッチング物件価格上限中古戸建', 99, 100],
  new_condo: ['マッチング物件価格下限新築マンション', 'マッチング物件価格上限新築マンション', 101, 102],
  used_condo: ['マッチング物件価格下限中古マンション', 'マッチング物件価格上限中古マンション', 103, 104],
  land: ['マッチング物件価格下限土地', 'マッチング物件価格上限土地', 105, 106],
  commercial: ['マッチング物件価格下限事業用', 'マッチング物件価格上限事業用', 107, 108],
}

// 面積を書く種別（A2-0: 専有=戸建とマンション / 土地面積=戸建と土地）。
const FLOOR_AREA_TYPES = new Set(['new_detached', 'used_detached', 'new_condo', 'used_condo'])
const LAND_AREA_TYPES = new Set(['new_detached', 'used_detached', 'land'])

// 住所の町域（列43）巡回 10 種。列41=愛知県 / 列42=岡崎市。
const TOWNS = [
  '上三ツ木町', '大平町', '福岡町', '美合町', '矢作町',
  '羽根町', '北野町', '井田町', '細川町', '明大寺町',
]
// マッチング小学校（列115）巡回 8 校（岡崎の公開校区に実在＝PM 実測）。
const SCHOOLS = [
  '六ッ美中部小学校', '福岡小学校', '美合小学校', '矢作北小学校',
  '羽根小学校', '北野小学校', '井田小学校', '細川小学校',
]
// 表記ゆれ: 「岡崎市立○○小」（末尾「学校」を落として「岡崎市立」を冠する）。
function schoolVariant(name) {
  return `岡崎市立${name.replace(/学校$/, '')}`
}

// =====================================================================
// ヘッダ読み取り＆列解決
// =====================================================================
// ヘッダ 1 行を配列へ（引用符対応の最小 CSV パーサ）。
function parseCsvLine(line) {
  const out = []
  let field = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++ } else { inQ = false }
      } else field += c
    } else if (c === '"') inQ = true
    else if (c === ',') { out.push(field); field = '' }
    else field += c
  }
  out.push(field)
  return out
}

function norm(s) {
  return (s ?? '').normalize('NFKC').trim()
}

// 完全一致する列の nth 番目（0 始まり）の 0 始まり index を返す。無ければ -1。
function findCol(header, name, nth = 0) {
  const want = norm(name)
  let seen = 0
  for (let i = 0; i < header.length; i++) {
    if (norm(header[i]) === want) {
      if (seen === nth) return i
      seen++
    }
  }
  return -1
}

// 全列を解決し、A2-0 実測の 1 始まり列番号と一致することを assert する（S-1）。
function resolveColumns(header) {
  if (header.length !== 174) {
    fatal(`S-1: fixture v1 のヘッダが 174 列ではありません（実際 ${header.length} 列）`)
  }
  const col = {}
  const assert1 = (name, expected1, nth = 0) => {
    const idx = findCol(header, name, nth)
    if (idx < 0) fatal(`S-1: ヘッダに「${name}」が見つかりません`)
    if (idx + 1 !== expected1) {
      fatal(`S-1: 「${name}」の列番号が不一致（期待 ${expected1} / 実際 ${idx + 1}）`)
    }
    return idx
  }
  for (const [name, expected1] of Object.entries(EXPECTED_COL)) {
    col[name] = assert1(name, expected1)
  }
  col['反響媒体'] = assert1('反響媒体', EXPECTED_MEDIA_COL, 0)
  // 価格 6 組。
  col.price = {}
  for (const [code, [loH, hiH, loExp, hiExp]] of Object.entries(PRICE_HEADERS)) {
    col.price[code] = [assert1(loH, loExp), assert1(hiH, hiExp)]
  }
  return col
}

// =====================================================================
// 名簿仕様（この表が正・105 行）
// =====================================================================
// 受付日レンジ [ [y,m,d]開始, [y,m,d]終了 ]。
const RANGES = {
  A_main: [[2025, 10, 15], [2026, 1, 31]],
  A_out: [[2025, 6, 1], [2025, 8, 31]], // 境界外 buy（直近12ヶ月フィルタから外れる）
  B_main: [[2026, 2, 1], [2026, 5, 31]],
  C_main: [[2026, 6, 1], [2026, 9, 12]],
}

// 名簿ごとの buy(境界内) 種別内訳（合計 80。土地/新築マンションは A/B/C=2/1/1）。
//   他 3 種（中古戸建44/新築戸建12/中古マンション16）は残スロット 18/27/27 に概ね均等配分。
const BUY_INNER_TYPES = {
  A: { used_detached: 11, new_detached: 3, used_condo: 4, land: 2, new_condo: 2 }, // 22
  B: { used_detached: 16, new_detached: 5, used_condo: 6, land: 1, new_condo: 1 }, // 29
  C: { used_detached: 17, new_detached: 4, used_condo: 6, land: 1, new_condo: 1 }, // 29
}
// 名簿ごとの境界外 buy（全て中古戸建）。A のみ 5。
const BUY_OUTER = { A: 5, B: 0, C: 0 }
// 名簿ごとの sell 物件種別内訳（列150。合計 中古戸建8/中古マンション4/土地3）。
const SELL_TYPES = {
  A: { used_detached: 3, used_condo: 1, land: 1 }, // 5
  B: { used_detached: 3, used_condo: 1, land: 1 }, // 5
  C: { used_detached: 2, used_condo: 2, land: 1 }, // 5
}
// 名簿ごとの区分なし件数。
const BLANK_COUNT = { A: 3, B: 1, C: 1 }

// 種別カウント表 → トークン配列へ展開。
function expandTypes(counts) {
  const out = []
  for (const [code, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) out.push(code)
  }
  return out
}

// =====================================================================
// 乱数ヘルパ（rng を固定順で消費する）
// =====================================================================
function makeHelpers(rng) {
  const randInt = (min, max) => min + Math.floor(rng() * (max - min + 1))
  const choice = (arr) => arr[Math.floor(rng() * arr.length)]
  // Fisher–Yates（seed 依存で決定的）。
  const shuffle = (arr) => {
    const a = arr.slice()
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }
  const dateInRange = ([s, e]) => {
    const sMs = Date.UTC(s[0], s[1] - 1, s[2])
    const eMs = Date.UTC(e[0], e[1] - 1, e[2])
    const days = Math.floor((eMs - sMs) / 86400000)
    const dt = new Date(sMs + randInt(0, days) * 86400000)
    const p2 = (n) => String(n).padStart(2, '0')
    return `${dt.getUTCFullYear()}/${p2(dt.getUTCMonth() + 1)}/${p2(dt.getUTCDate())}`
  }
  return { randInt, choice, shuffle, dateInRange }
}

// 価格帯（万円・整数・接尾辞なし）。45%→2000-2500 / 35%→3000-3500 / 20%→1500-4500 散布。
//   上限＝下限＋(300〜800・100 刻み)。band は検証用に返す。
function makePrice(h) {
  const r = h.__rng()
  let band, lower
  if (r < 0.45) { band = 'band1_2000_2500'; lower = h.randInt(20, 25) * 100 }
  else if (r < 0.80) { band = 'band2_3000_3500'; lower = h.randInt(30, 35) * 100 }
  else { band = 'band3_scatter'; lower = h.randInt(15, 45) * 100 }
  const upper = lower + h.choice([300, 400, 500, 600, 700, 800])
  return { band, lower, upper }
}
// 専有面積（下限70-110 / 上限=下限+20-30・≤130）。
function makeFloorArea(h) {
  const lo = h.randInt(70, 110)
  const hi = Math.min(lo + h.randInt(20, 30), 130)
  return [lo, hi]
}
// 土地面積（下限100-200 / 上限=下限+30-50・≤250）。
function makeLandArea(h) {
  const lo = h.randInt(100, 200)
  const hi = Math.min(lo + h.randInt(30, 50), 250)
  return [lo, hi]
}

// =====================================================================
// 行生成
// =====================================================================
function blankRow() {
  return new Array(174).fill('')
}

// 生成状態（巡回カウンタ）を関数間で共有する。
function makeGen(col, h) {
  let townIdx = 0
  let schoolCycle = 0

  const setCommon = (row, custNo, name, assignee, media, date, town) => {
    row[col['顧客番号']] = custNo
    row[col['顧客名']] = name
    row[col['店舗営業担当者']] = assignee
    row[col['反響媒体']] = media
    row[col['受付日']] = date
    row[col['都道府県']] = '愛知県'
    row[col['市区']] = '岡崎市'
    row[col['住所']] = town
  }

  const nextTown = () => TOWNS[townIdx++ % TOWNS.length]

  // buy 行。type=code, range=受付日レンジ, boundary=境界外か。
  const buyRow = (custNo, name, assignee, type, range, boundary) => {
    const row = blankRow()
    const meta = { list: null, kind: 'buy', type, boundary, band: null, schoolFilled: false, schoolVariant: false, town: null }
    const town = nextTown()
    meta.town = town
    setCommon(row, custNo, name, assignee, 'デモ', h.dateInRange(range), town)
    row[col['顧客種別']] = '買主'
    row[col['マッチング物件種別']] = TYPE_LABEL[type]
    // 価格（種別に対応する 1 組にのみ）。
    const price = makePrice(h)
    meta.band = price.band
    const [loCol, hiCol] = col.price[type]
    row[loCol] = String(price.lower)
    row[hiCol] = String(price.upper)
    // 専有面積（列111/112）。
    if (FLOOR_AREA_TYPES.has(type)) {
      const [lo, hi] = makeFloorArea(h)
      row[col['マッチング専有面積下限']] = String(lo)
      row[col['マッチング専有面積上限']] = String(hi)
    }
    // 土地面積（列109/110）。
    if (LAND_AREA_TYPES.has(type)) {
      const [lo, hi] = makeLandArea(h)
      row[col['マッチング土地面積下限']] = String(lo)
      row[col['マッチング土地面積上限']] = String(hi)
    }
    // マッチング小学校（列115）。90% 記入・そのうち 10% は表記ゆれ・残り 10% 空。
    if (h.__rng() < 0.9) {
      const base = SCHOOLS[schoolCycle++ % SCHOOLS.length]
      const variant = h.__rng() < 0.1
      row[col['マッチング小学校']] = variant ? schoolVariant(base) : base
      meta.schoolFilled = true
      meta.schoolVariant = variant
    }
    return { row, meta }
  }

  // sell 行（列150 物件種別のみ）。
  const sellRow = (custNo, name, assignee, type, range) => {
    const row = blankRow()
    const town = nextTown()
    setCommon(row, custNo, name, assignee, 'デモ', h.dateInRange(range), town)
    row[col['顧客種別']] = '売主'
    row[col['物件種別']] = TYPE_LABEL[type]
    return { row, meta: { kind: 'sell', type, boundary: false, band: null, schoolFilled: false, schoolVariant: false, town } }
  }

  // 区分なし行（顧客種別 空・その他も空）。
  const blankKindRow = (custNo, name, assignee, range) => {
    const row = blankRow()
    const town = nextTown()
    setCommon(row, custNo, name, assignee, 'デモ', h.dateInRange(range), town)
    row[col['顧客種別']] = ''
    return { row, meta: { kind: 'blank', type: null, boundary: false, band: null, schoolFilled: false, schoolVariant: false, town } }
  }

  return { buyRow, sellRow, blankKindRow }
}

// 1 名簿ぶんの行を生成する（出力順: buy境界内 → buy境界外 → sell → 区分なし）。
function buildList(listLetter, col, h, gen) {
  const rows = []
  const metas = []
  let seq = 0 // 顧客番号連番（DEMO-X-001..）
  let buyN = 0
  let sellN = 0
  let otherN = 0
  const assignee = `架空　担当${listLetter}`
  const nextCust = () => `DEMO-${listLetter}-${String(++seq).padStart(3, '0')}`
  const buyName = () => `架空　買${String(++buyN).padStart(2, '0')}`
  const sellName = () => `架空　売${String(++sellN).padStart(2, '0')}`
  const otherName = () => `架空　他${String(++otherN).padStart(2, '0')}`

  const mainRange = RANGES[`${listLetter}_main`]

  // buy 境界内（種別をシャッフルして混在させる）。
  const innerTypes = h.shuffle(expandTypes(BUY_INNER_TYPES[listLetter]))
  for (const type of innerTypes) {
    const { row, meta } = gen.buyRow(nextCust(), buyName(), assignee, type, mainRange, false)
    meta.list = listLetter
    rows.push(row); metas.push(meta)
  }
  // buy 境界外（中古戸建・受付日は境界外レンジ）。A のみ。
  for (let i = 0; i < BUY_OUTER[listLetter]; i++) {
    const { row, meta } = gen.buyRow(nextCust(), buyName(), assignee, 'used_detached', RANGES[`${listLetter}_out`], true)
    meta.list = listLetter
    rows.push(row); metas.push(meta)
  }
  // sell（物件種別をシャッフル）。
  const sellTypes = h.shuffle(expandTypes(SELL_TYPES[listLetter]))
  for (const type of sellTypes) {
    const { row, meta } = gen.sellRow(nextCust(), sellName(), assignee, type, mainRange)
    meta.list = listLetter
    rows.push(row); metas.push(meta)
  }
  // 区分なし。
  for (let i = 0; i < BLANK_COUNT[listLetter]; i++) {
    const { row, meta } = gen.blankKindRow(nextCust(), otherName(), assignee, mainRange)
    meta.list = listLetter
    rows.push(row); metas.push(meta)
  }
  return { rows, metas }
}

// =====================================================================
// CSV 書き出し（UTF-8 BOM / CRLF / 必要時のみ "" クオート）
// =====================================================================
function csvField(v) {
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function toCsv(header, rows) {
  const lines = [header.map(csvField).join(',')]
  for (const r of rows) lines.push(r.map(csvField).join(','))
  return '﻿' + lines.join('\r\n') + '\r\n'
}
function sha256(text) {
  return createHash('sha256').update(Buffer.from(text, 'utf-8')).digest('hex')
}

// =====================================================================
// 自己検証（summary 用の集計。生値は出さず件数・分布のみ）
// =====================================================================
function verifyList(rows, metas, col) {
  const colCounts = new Set(rows.map((r) => r.length))
  const lead = { buy: 0, sell: 0, blank: 0 }
  for (const r of rows) {
    const v = r[col['顧客種別']]
    if (v === '買主') lead.buy++
    else if (v === '売主') lead.sell++
    else lead.blank++
  }
  const buyTypeByCol96 = {}
  const sellTypeByCol150 = {}
  const bandDist = {}
  let boundaryBuy = 0
  let schoolFilled = 0
  let schoolVariantCount = 0
  const townDist = {}
  for (const m of metas) {
    if (m.kind === 'buy') {
      buyTypeByCol96[m.type] = (buyTypeByCol96[m.type] ?? 0) + 1
      bandDist[m.band] = (bandDist[m.band] ?? 0) + 1
      if (m.boundary) boundaryBuy++
      if (m.schoolFilled) schoolFilled++
      if (m.schoolVariant) schoolVariantCount++
    } else if (m.kind === 'sell') {
      sellTypeByCol150[m.type] = (sellTypeByCol150[m.type] ?? 0) + 1
    }
    townDist[m.town] = (townDist[m.town] ?? 0) + 1
  }
  const custIds = rows.map((r) => r[col['顧客番号']])
  const buyN = lead.buy
  return {
    rows: rows.length,
    col_counts: [...colCounts], // 期待 [174]
    lead,
    buy_type_col96: buyTypeByCol96,
    sell_type_col150: sellTypeByCol150,
    boundary_buy: boundaryBuy,
    price_band_dist: bandDist,
    school_fill_rate: buyN ? Number((schoolFilled / buyN).toFixed(3)) : 0,
    school_variant_count: schoolVariantCount,
    town_dist: townDist,
    cust_id_unique: new Set(custIds).size === custIds.length,
  }
}

// =====================================================================
// main
// =====================================================================
function main() {
  const args = parseArgs(process.argv.slice(2))

  // リポジトリ位置を script の場所から求める（scripts/ の親）。
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(scriptDir, '..')

  // ⛔ 出力先ガード: --out が本リポジトリ配下なら 1 バイトも書かずに終了する。
  const outDir = path.resolve(args.out)
  if (outDir === repoRoot || outDir.startsWith(repoRoot + path.sep)) {
    fatal(`出力先がリポジトリ配下です（禁止）: ${outDir}\n  リポジトリ外のディレクトリを --out に指定してください。`)
  }

  // ヘッダ（174 列）を fixture v1 の 1 行目から実行時に読む。
  const fixturePath = path.join(repoRoot, 'docs/specs/hausudo_customer_headers_fixture_v1.csv')
  const raw = readFileSync(fixturePath, 'utf-8')
  const firstLine = raw.replace(/^﻿/, '').split(/\r?\n/)[0]
  const header = parseCsvLine(firstLine)
  const col = resolveColumns(header) // ここで S-1 assert

  // 生成。
  const rng = mulberry32(args.seed)
  const h = makeHelpers(rng)
  h.__rng = rng // makePrice / school 判定でも同じ rng を使う
  const gen = makeGen(col, h)

  const listResults = {}
  for (const letter of ['A', 'B', 'C']) {
    listResults[letter] = buildList(letter, col, h, gen)
  }

  // 書き出し＆検証。
  mkdirSync(outDir, { recursive: true })
  const files = {}
  const allCustIds = []
  for (const letter of ['A', 'B', 'C']) {
    const { rows, metas } = listResults[letter]
    const csv = toCsv(header, rows)
    const fname = `demo_buyer_match_${letter}.csv`
    writeFileSync(path.join(outDir, fname), csv, 'utf-8')
    const stats = verifyList(rows, metas, col)
    stats.sha256 = sha256(csv)
    stats.file = fname
    files[letter] = stats
    for (const r of rows) allCustIds.push(r[col['顧客番号']])
  }

  const summary = {
    generator: 'gen-demo-buyer-match.mjs',
    arbitration: '裁定85',
    seed: args.seed,
    header_source: 'docs/specs/hausudo_customer_headers_fixture_v1.csv (1行目・逐語)',
    header_cols: header.length, // 174
    column_assert: 'ok',
    encoding: 'utf-8-bom',
    newline: 'CRLF',
    total_rows: allCustIds.length, // 105
    cust_id_unique_global: new Set(allCustIds).size === allCustIds.length,
    files,
  }
  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf-8')

  // 端末サマリ（生値は出さない）。
  console.log(`[gen-demo-buyer-match] seed=${args.seed} → ${outDir}`)
  for (const letter of ['A', 'B', 'C']) {
    const s = files[letter]
    console.log(
      `  ${s.file}: rows=${s.rows} cols=${JSON.stringify(s.col_counts)} ` +
      `lead=${JSON.stringify(s.lead)} boundary_buy=${s.boundary_buy} ` +
      `school_fill=${s.school_fill_rate} variant=${s.school_variant_count} sha256=${s.sha256.slice(0, 12)}…`,
    )
  }
  console.log(`  summary.json 書き出し完了 / 顧客番号一意(全105)=${summary.cust_id_unique_global}`)
}

main()

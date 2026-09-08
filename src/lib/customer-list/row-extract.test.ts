// 行抽出（external_id の文字列維持・日付の NULL 化＋根拠・PII 読み捨て）のユニットテスト。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseCsv, detectColumnMapping } from './csv-import.ts'
import { extractRows, EXTRACT_KEYS, DISCARDED_KEYS } from './row-extract.ts'
import type { PropertyTypeCode } from './presets.ts'

// 架空のフィクスチャ（ハウスドゥ形式のヘッダ 174 列・データ 1 行）。
//   ⛔ 顧客の生データではない。docs/specs 配下の架空データのみを使う。
const FIXTURE_PATH = new URL(
  '../../../docs/specs/hausudo_customer_headers_fixture_v1.csv',
  import.meta.url,
)

test('extractRows: 顧客番号はゼロ落ち・指数表記化させず文字列のまま保持する', () => {
  const csv =
    '顧客番号,住所\n' +
    '0009990001,岡崎市稲熊町3-1\n' +
    '9999999999999999999,岡崎市稲熊町3-2\n' +
    '1e5,岡崎市稲熊町3-3\n'
  const rows = parseCsv(csv)
  const out = extractRows(rows.slice(1), detectColumnMapping(rows[0]))

  assert.equal(out[0].external_id, '0009990001') // 先頭ゼロが落ちない
  assert.equal(out[1].external_id, '9999999999999999999') // 精度落ちしない
  assert.equal(out[2].external_id, '1e5') // 指数表記として解釈されない
  for (const r of out) assert.equal(typeof r.external_id, 'string')
})

test('extractRows: 空の顧客番号は null（＝追跡不能行として UPSERT 対象外にする）', () => {
  const csv = '顧客番号,住所\n,岡崎市稲熊町3-1\n   ,岡崎市稲熊町3-2\n'
  const rows = parseCsv(csv)
  const out = extractRows(rows.slice(1), detectColumnMapping(rows[0]))
  assert.equal(out[0].external_id, null)
  assert.equal(out[1].external_id, null)
})

test('extractRows: 未知の日付書式は推測せず null にし reason を残す（原則1）', () => {
  const csv =
    '反響日,最終接触日,住所\n' +
    '2026/08/01,2026年8月5日,岡崎市稲熊町3-1\n' +
    '不明,2026/02/30,岡崎市稲熊町3-2\n'
  const rows = parseCsv(csv)
  const out = extractRows(rows.slice(1), detectColumnMapping(rows[0]))

  assert.equal(out[0].inquiry_at, '2026-08-01T00:00:00Z')
  assert.equal(out[0].last_contact_at, '2026-08-05T00:00:00Z')
  assert.deepEqual(out[0].reasons, [])

  // 読めない値・暦として存在しない日付はどちらも null。理由は区別して残す。
  assert.equal(out[1].inquiry_at, null)
  assert.equal(out[1].last_contact_at, null)
  assert.deepEqual(out[1].reasons, [
    'inquiry_at:date_unparsed',
    'last_contact_at:date_invalid',
  ])
})

test('extractRows: PII 列は ExtractedRow のキーにも値にも現れない（CL-32）', () => {
  const csv =
    '顧客名,顧客名フリガナ,電話番号,メールアドレス,生年月日,住所\n' +
    '架空太郎,カクウタロウ,090-1234-5678,himitsu@example.com,1990/01/01,岡崎市稲熊町3-1\n'
  const rows = parseCsv(csv)
  const out = extractRows(rows.slice(1), detectColumnMapping(rows[0]))

  // 氏名のみ保持（CL-32: アタックリストは「誰に架電するか」を出す画面）。
  assert.equal(out[0].customer_name, '架空太郎')

  // キーとして存在しない。
  assert.ok(!('phone' in out[0]))
  assert.ok(!('email' in out[0]))
  assert.ok(!('kana' in out[0]))
  for (const key of DISCARDED_KEYS) assert.ok(!EXTRACT_KEYS.includes(key))

  // 値としても一切到達しない（シリアライズ全文に現れない＝変数に保持していない）。
  const serialized = JSON.stringify(out)
  assert.ok(!serialized.includes('090-1234-5678'))
  assert.ok(!serialized.includes('himitsu@example.com'))
  assert.ok(!serialized.includes('カクウタロウ'))
})

test('extractRows: 174列の架空フィクスチャを流しても落ちず、顧客番号とPII方針を守る', () => {
  // ⚠ 本 PR ではこのフィクスチャを「エンコーディング / external_id の文字列維持 /
  //    PII 読み捨て」の検証にのみ使う。ハウスドゥ形式の列マッピング精度は PR-C の責務で、
  //    ここでは主張しない（v0 のキーワード検出は 174 列に対して誤検出する）。
  const csv = readFileSync(FIXTURE_PATH, 'utf8')
  const rows = parseCsv(csv)
  assert.equal(rows[0].length, 174)

  const out = extractRows(rows.slice(1), detectColumnMapping(rows[0]))
  assert.equal(out.length, 1)
  assert.equal(out[0].external_id, '9990001')
  assert.equal(typeof out[0].external_id, 'string')

  const serialized = JSON.stringify(out)
  assert.ok(!serialized.includes('test@example.com')) // メールアドレス
  assert.ok(!serialized.includes('カクウ')) // フリガナ
  assert.ok(!serialized.includes('000-0000-0000')) // 電話番号
})

// ── 購入希望マッチ（BM-2 / c4）────────────────────────────────────────
// label_ja → property_types.code の解決表のスタブ。
//   ⛔ 本番は property_types を 1 回 SELECT して作る（TS にハードコードしない）。
//      テストはその戻り値の形（Map）だけを模す。
const TYPE_DICT = new Map<string, PropertyTypeCode>([
  ['新築戸建', 'new_detached'],
  ['中古戸建', 'used_detached'],
  ['新築マンション', 'new_condo'],
  ['中古マンション', 'used_condo'],
  ['土地', 'land'],
  ['事業用', 'commercial'],
])

// BM-2 の抽出だけを見たいので、必要最小限の列を持つ CSV で組み立てる。
//   列 index: 0=顧客種別 1=マッチング物件種別 2=物件種別
//             3,4=新築戸建 下限/上限 5,6=土地 下限/上限
//             7,8=専有面積 下限/上限 9,10=土地面積 下限/上限
const BM_OPTS = {
  propertyTypeColumn: 1,
  sellPropertyTypeColumn: 2,
  priceColumns: {
    new_detached: { min: 3, max: 4 },
    land: { min: 5, max: 6 },
  },
  floorAreaColumns: { min: 7, max: 8 },
  landAreaColumns: { min: 9, max: 10 },
  propertyTypeByLabel: TYPE_DICT,
}
const BM_MAPPING = { category: 0 }

function extractBm(dataRow: string[], opts: Partial<typeof BM_OPTS> = {}) {
  return extractRows([dataRow], BM_MAPPING, { ...BM_OPTS, ...opts })[0]
}

test('extractRows(BM): lead_type は辞書で決まり、空でも unknown が必ず入る', () => {
  assert.equal(extractBm(['買主', '', '', '', '', '', '', '', '', '', '']).lead_type, 'buy')
  assert.equal(extractBm(['売主', '', '', '', '', '', '', '', '', '', '']).lead_type, 'sell')
  assert.equal(extractBm(['', '', '', '', '', '', '', '', '', '', '']).lead_type, 'unknown')
  assert.equal(extractBm(['法人', '', '', '', '', '', '', '', '', '', '']).lead_type, 'unknown')
})

test('extractRows(BM): 買い行の第一根拠＝マッチング物件種別（複数トークン・is_primary=true）', () => {
  const r = extractBm(['買主', '新築戸建、土地', '', '', '', '', '', '', '', '', ''])
  assert.deepEqual(r.property_types, [
    { code: 'new_detached', price_min: null, price_max: null, is_primary: true },
    { code: 'land', price_min: null, price_max: null, is_primary: true },
  ])
  assert.deepEqual(r.reasons, [])
})

test('extractRows(BM): 区切りは , 、 / ／ 空白のいずれでもよい（NFKC 後に評価）', () => {
  for (const raw of [
    '新築戸建,土地',
    '新築戸建、土地',
    '新築戸建/土地',
    '新築戸建／土地',
    '新築戸建 土地',
    '新築戸建　土地',
  ]) {
    const r = extractBm(['買主', raw, '', '', '', '', '', '', '', '', ''])
    assert.deepEqual(
      r.property_types.map((p) => p.code),
      ['new_detached', 'land'],
      `区切り: ${raw}`,
    )
  }
})

test('extractRows(BM): 未知トークンは子行を作らず reason に残す（⛔ 推測しない）', () => {
  const r = extractBm(['買主', '新築戸建、一戸建て', '', '', '', '', '', '', '', '', ''])
  assert.deepEqual(
    r.property_types.map((p) => p.code),
    ['new_detached'],
  )
  assert.ok(r.reasons.includes('property_type:unknown_token:一戸建て'))
})

test('extractRows(BM): 第二根拠＝価格。明示済み code は価格だけ補完される', () => {
  const r = extractBm(['買主', '新築戸建', '', '3000', '4,000万円', '', '', '', '', '', ''])
  assert.deepEqual(r.property_types, [
    { code: 'new_detached', price_min: 3000, price_max: 4000, is_primary: true },
  ])
  assert.deepEqual(r.reasons, [])
})

test('extractRows(BM): 価格だけの種別は is_primary=false の子行を作る（片側だけでも作る）', () => {
  // 種別の明示なし・土地の上限だけ記入 → 土地の子行が価格だけで生まれる。
  const r = extractBm(['買主', '', '', '', '', '', '2000', '', '', '', ''])
  assert.deepEqual(r.property_types, [
    { code: 'land', price_min: null, price_max: 2000, is_primary: false },
  ])
})

test('extractRows(BM): 明示種別と価格の食い違いは第一根拠を優先し reason に残す', () => {
  // 明示は新築戸建だけ。価格は土地にも入っている。
  const r = extractBm(['買主', '新築戸建', '', '3000', '', '', '2000', '', '', '', ''])
  assert.deepEqual(r.property_types, [
    { code: 'new_detached', price_min: 3000, price_max: null, is_primary: true },
    { code: 'land', price_min: null, price_max: 2000, is_primary: false },
  ])
  assert.ok(r.reasons.includes('property_type:price_without_type:land'))
})

test('extractRows(BM): 不正な価格書式は子行を作りつつ値を null にし reason を残す', () => {
  const r = extractBm(['買主', '新築戸建', '', '約3000', '', '', '', '', '', '', ''])
  assert.deepEqual(r.property_types, [
    { code: 'new_detached', price_min: null, price_max: null, is_primary: true },
  ])
  assert.ok(r.reasons.includes('price_new_detached_min:unparsed'))
})

test('extractRows(BM): 売り行は 物件種別 が完全一致したときだけ子行 1 本（価格 NULL）', () => {
  const ok = extractBm(['売主', '', '中古戸建', '', '', '', '', '', '', '', ''])
  assert.deepEqual(ok.property_types, [
    { code: 'used_detached', price_min: null, price_max: null, is_primary: true },
  ])

  const ng = extractBm(['売主', '', '一戸建て', '', '', '', '', '', '', '', ''])
  assert.deepEqual(ng.property_types, [])
  assert.ok(ng.reasons.includes('sell_property_type:unresolved:一戸建て'))
})

test('extractRows(BM): 売り行は買い行の根拠（マッチング物件種別・価格）を読まない', () => {
  const r = extractBm(['売主', '新築戸建', '', '3000', '4000', '', '', '', '', '', ''])
  assert.deepEqual(r.property_types, [])
})

test('extractRows(BM): unknown 行は子行を作らない（どちらの根拠も適用しない）', () => {
  const r = extractBm(['', '新築戸建', '中古戸建', '3000', '', '', '', '', '', '', ''])
  assert.deepEqual(r.property_types, [])
})

test('extractRows(BM): 希望面積 4 値は㎡整数で入り、坪は換算せず null + reason', () => {
  const ok = extractBm(['買主', '', '', '', '', '', '', '80', '120㎡', '150', '200'])
  assert.equal(ok.desired_floor_area_min, 80)
  assert.equal(ok.desired_floor_area_max, 120)
  assert.equal(ok.desired_land_area_min, 150)
  assert.equal(ok.desired_land_area_max, 200)
  assert.deepEqual(ok.reasons, [])

  const tsubo = extractBm(['買主', '', '', '', '', '', '', '', '', '30坪', ''])
  assert.equal(tsubo.desired_land_area_min, null)
  assert.ok(tsubo.reasons.includes('desired_land_area_min:unparsed'))
})

test('extractRows(BM): 列が未解決（heuristic 経路）なら子行なし・面積は全て null', () => {
  const r = extractRows([['買主', '新築戸建', '中古戸建', '3000', '', '', '', '80', '', '', '']], BM_MAPPING)
  assert.equal(r[0].lead_type, 'buy') // category は mapping 経由なので読める
  assert.deepEqual(r[0].property_types, [])
  assert.equal(r[0].desired_floor_area_min, null)
  assert.equal(r[0].desired_land_area_max, null)
  assert.deepEqual(r[0].reasons, [])
})

test('extractRows(BM): 解決表が無いときは子行を作らず resolver_unavailable を残す', () => {
  const r = extractBm(['買主', '新築戸建', '', '', '', '', '', '', '', '', ''], {
    propertyTypeByLabel: undefined,
  })
  assert.deepEqual(r.property_types, [])
  assert.ok(r.reasons.includes('property_type:resolver_unavailable'))
})

test('extractRows(BM): 同じ種別が 2 回書かれていても子行は 1 本', () => {
  const r = extractBm(['買主', '新築戸建、新築戸建', '', '', '', '', '', '', '', '', ''])
  assert.equal(r.property_types.length, 1)
  assert.equal(r.property_types[0].code, 'new_detached')
})

test('extractRows(BM): EXTRACT_KEYS を増やさずに新列を読んでいる（CL-32 の構造的担保）', () => {
  // BM-2 の新列はすべて ExtractOptions の index 指定経路で読む。許可リストは 8 件のまま。
  assert.equal(EXTRACT_KEYS.length, 8)
  assert.equal(EXTRACT_KEYS.includes('phone' as never), false)
})

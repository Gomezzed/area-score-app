// 購入希望マッチ（BM-2）の統合テスト — 架空フィクスチャ v2 を
//   parse → 列解決 → 抽出 → UPSERT 計画 → サマリ まで通しで固定する。
//   ⛔ DB には一切接続しない（純ロジックの結線だけを検証する）。
//   ⛔ 顧客の生データは使わない。docs/specs の架空フィクスチャのみ。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseCsv } from './csv-import.ts'
import { resolveColumnMapping, buildColumnMappingV3 } from './presets.ts'
import { extractRows, countDateNullRows } from './row-extract.ts'
import { planUpsert } from './upsert-plan.ts'
import { summarizeImportConditions } from './import-summary.ts'
import type { PropertyTypeCode } from './presets.ts'
import type { MatchResult } from './types.ts'

// 架空フィクスチャ v2（買主10・売主3・顧客種別なし1／174 列）。
//   買主のうち2行（9990109/9990110）は PR-BM-3 で追加した校区表記ゆれ固定用
//   （六ッ美中部小学校／岡崎市立六ッ美中部小・どちらも実在の公開校名で個人情報ではない）。
const FIXTURE_V2 = new URL(
  '../../../docs/specs/hausudo_customer_headers_fixture_v2_bm.csv',
  import.meta.url,
)

// property_types（is_active=true）の SELECT 結果を模した解決表。
//   ⛔ 本番は DB から作る。ここは注入の形だけを模す。
const TYPE_DICT = new Map<string, PropertyTypeCode>([
  ['新築戸建', 'new_detached'],
  ['中古戸建', 'used_detached'],
  ['新築マンション', 'new_condo'],
  ['中古マンション', 'used_condo'],
  ['土地', 'land'],
  ['事業用', 'commercial'],
])

const LIST = '00000000-0000-4000-8000-00000000list'
const USER = '00000000-0000-4000-8000-00000000user'

// 突合結果はこのテストの関心外なので、全行同じ out_of_scope で固定する。
const MATCH: MatchResult = {
  status: 'out_of_scope',
  municipality_id: null,
  town_name_normalized: null,
  candidates: [],
  address_normalized: '',
}

function pipeline() {
  const rows = parseCsv(readFileSync(FIXTURE_V2, 'utf8'))
  const header = rows[0]
  const resolved = resolveColumnMapping(header, 'hausudo')
  const extracted = extractRows(rows.slice(1), resolved.mapping, {
    ...resolved.extract,
    propertyTypeByLabel: TYPE_DICT,
  })
  let n = 0
  const plan = planUpsert({
    listId: LIST,
    userId: USER,
    extracted,
    matches: extracted.map(() => MATCH),
    existingByExternalId: new Map(),
    newId: () => `row-${++n}`,
    persistDesiredSchool: resolved.extract.schoolColumn != null,
    persistDesiredArea:
      resolved.extract.floorAreaColumns != null || resolved.extract.landAreaColumns != null,
  })
  return { header, resolved, extracted, plan }
}

test('BM 統合: フィクスチャ v2 はヘッダ 174 列・14 行で hausudo として解決される', () => {
  const { header, resolved, extracted } = pipeline()
  assert.equal(header.length, 174)
  assert.equal(extracted.length, 14)
  assert.equal(resolved.route, 'preset:hausudo')
  // BM-2 の列がすべて解決できている（未解決なら以降の期待値が成立しない）。
  assert.notEqual(resolved.extract.propertyTypeColumn, undefined)
  assert.notEqual(resolved.extract.sellPropertyTypeColumn, undefined)
  assert.notEqual(resolved.extract.priceColumns, undefined)
  assert.notEqual(resolved.extract.floorAreaColumns, undefined)
  assert.notEqual(resolved.extract.landAreaColumns, undefined)
})

test('BM 統合: lead_type は 買主10 / 売主3 / 区分なし1 に振り分けられる', () => {
  const { extracted } = pipeline()
  const counts = summarizeImportConditions(extracted, 0).lead_type
  assert.deepEqual(counts, { buy: 10, sell: 3, unknown: 1 })
})

test('BM 統合: 親 UPSERT のペイロードに lead_type と面積 4 列が載る', () => {
  const { plan } = pipeline()
  assert.equal(plan.tracked.length, 14)
  assert.equal(plan.untracked.length, 0)

  // 面積を書いた行（買主5）。㎡ の整数として載る。
  const area = plan.tracked.find((r) => r.external_id === '9990105')!
  assert.equal(area.lead_type, 'buy')
  assert.equal(area.desired_floor_area_min, 70)
  assert.equal(area.desired_floor_area_max, 95) // '95㎡' の接尾辞を外して解釈
  assert.equal(area.desired_land_area_min, 120)
  assert.equal(area.desired_land_area_max, 200)

  // 顧客種別が空の行は unknown を明示的に書く（前回値を残さない）。
  const unknown = plan.tracked.find((r) => r.external_id === '9990301')!
  assert.equal(unknown.lead_type, 'unknown')

  // 校区を書いた行は desired_school が載る（プリセットが列を解決したため）。
  const school = plan.tracked.find((r) => r.external_id === '9990106')!
  assert.equal(school.desired_school, '架空第一小学校')

  // ⛔ PII 列はペイロードのキーにも現れない（CL-32）。
  for (const r of plan.tracked) {
    assert.equal('phone' in r, false)
  }
})

// PR-BM-3: 校区の表記ゆれ（「〜立」接頭辞・「小学校/小」接尾辞の違い）2件が
//   extract 層でどちらも desired_school に生値のまま載ることを固定する。
//   ⛔ 名寄せ（正規化して同一校区に解決すること）は DB 側の
//     public.normalize_school_name / public.match_customer_list_desired_districts
//     （supabase/migrations/20260908000200_bm_desired_districts_match.sql）の役割。
//     本テストは DB を叩かないため、両者が実際に同じ school_district_id へ
//     解決されることまでは検証しない。ここで固定するのは
//     「extract 層が生値を落とさず・書き換えずにそのまま拾う」ことのみ。
test('BM 統合: 校区表記ゆれ2件（六ッ美中部小学校／岡崎市立六ッ美中部小）は desired_school に生値のまま載る', () => {
  const { plan } = pipeline()

  const plain = plan.tracked.find((r) => r.external_id === '9990109')!
  assert.equal(plain.lead_type, 'buy')
  assert.equal(plain.desired_school, '六ッ美中部小学校')

  const prefixed = plan.tracked.find((r) => r.external_id === '9990110')!
  assert.equal(prefixed.lead_type, 'buy')
  assert.equal(prefixed.desired_school, '岡崎市立六ッ美中部小')

  // 生値のまま（extract 層で正規化しない）＝2件の desired_school は文字列として不一致。
  //   同一校区への解決は DB 側の normalize_school_name の役割（このテストの対象外）。
  assert.notEqual(plain.desired_school, prefixed.desired_school)
})

test('BM 統合: 子行は行 id に紐づき、明示種別・価格のみ・売り行が意図どおり作られる', () => {
  const { plan } = pipeline()
  const idOf = (externalId: string) =>
    plan.tracked.find((r) => r.external_id === externalId)!.id
  const childrenOf = (externalId: string) =>
    plan.propertyTypeRows
      .filter((c) => c.row_id === idOf(externalId))
      .map((c) => ({
        code: c.property_type,
        min: c.price_min,
        max: c.price_max,
        primary: c.is_primary,
      }))

  // 買主1: 単一種別（価格なし）。
  assert.deepEqual(childrenOf('9990101'), [
    { code: 'new_detached', min: null, max: null, primary: true },
  ])
  // 買主2: 複数種別（読点区切り）。順序はトークンの並び。
  assert.deepEqual(childrenOf('9990102'), [
    { code: 'used_detached', min: null, max: null, primary: true },
    { code: 'land', min: null, max: null, primary: true },
  ])
  // 買主3: 価格のみ → is_primary=false の子行（桁区切り・万円の接尾辞を解釈）。
  assert.deepEqual(childrenOf('9990103'), [
    { code: 'land', min: 1000, max: 2000, primary: false },
  ])
  // 買主6: 明示種別＋その種別の価格 → 価格が補完される（子行は 1 本のまま）。
  assert.deepEqual(childrenOf('9990106'), [
    { code: 'new_detached', min: 3000, max: 4000, primary: true },
  ])
  // 買主8: 不正な価格書式 → 子行は作るが価格は null。未知トークンの子行は作らない。
  assert.deepEqual(childrenOf('9990108'), [
    { code: 'new_detached', min: null, max: null, primary: true },
  ])
  // 売主1: 物件種別が一致 → 価格 NULL の子行 1 本。
  assert.deepEqual(childrenOf('9990201'), [
    { code: 'used_detached', min: null, max: null, primary: true },
  ])
  // 売主2（未解決）・売主3（空）・顧客種別なし は子行なし。
  assert.deepEqual(childrenOf('9990202'), [])
  assert.deepEqual(childrenOf('9990203'), [])
  assert.deepEqual(childrenOf('9990301'), [])

  // 子行の所有情報は list/user が入る（DB 側でトリガーが親から上書きする）。
  for (const c of plan.propertyTypeRows) {
    assert.equal(c.list_id, LIST)
    assert.equal(c.user_id, USER)
  }
})

test('BM 統合: サマリは件数のみで、生値・トークンを含まない', () => {
  const { extracted, plan } = pipeline()
  const summary = summarizeImportConditions(extracted, plan.propertyTypeRows.length)

  assert.deepEqual(summary, {
    lead_type: { buy: 10, sell: 3, unknown: 1 },
    property_type_rows: plan.propertyTypeRows.length,
    // 買主8 の '一戸建て' ＋ 売主2 の '一戸建て' の 2 件。
    property_type_unknown_tokens: 2,
    // 買主8 の '約3000' と '3000〜4000' の 2 件。
    price_unparsed: 2,
    // 買主8 の '30坪' の 1 件。
    area_unparsed: 1,
  })

  // ⛔ サマリを JSON にしても顧客の生値・未解決トークンが混ざらない。
  const json = JSON.stringify(summary)
  for (const raw of ['一戸建て', '約3000', '30坪', '架空', '上三ツ木町']) {
    assert.equal(json.includes(raw), false, `サマリに生値 ${raw} が混ざっている`)
  }
})

test('BM 統合: date_null_rows は BM の reason で増えない（裁定8）', () => {
  const { extracted } = pipeline()
  // v2 の日付列（受付日・更新日）はすべて正しい書式なので 0 件。
  //   BM 由来の reason（未知トークン・不正価格・坪）は持っている行がある。
  assert.ok(extracted.some((e) => e.reasons.length > 0))
  assert.equal(countDateNullRows(extracted), 0)
})

test('BM 統合: column_mapping v:3 が v:2 のキーを保ったまま列 index を持つ', () => {
  const { header, resolved } = pipeline()
  const m = buildColumnMappingV3(
    header,
    resolved.mapping,
    resolved.extract,
    resolved.route,
    'hausudo',
  )
  assert.equal(m.v, 3)
  assert.equal(m.preset_id, 'hausudo')
  assert.deepEqual(m.address_columns, ['都道府県', '市区', '住所'])
  assert.equal(m.propertyTypeColumn, 95)
  assert.equal(m.sellPropertyTypeColumn, 149)
  assert.deepEqual(m.floorAreaColumns, { min: 110, max: 111 })
})

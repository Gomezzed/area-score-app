// ハウスドゥ形式プリセット（CL-03）のユニットテスト。依存ゼロ。
//   ⛔ 顧客の生データは使わない。架空フィクスチャ（docs/specs 配下）のみ。
//   O49: v0 のキーワード検出は 174 列に対して誤検出するため、ここでは
//        「ヘッダ名の完全一致＋同名列の位置指定」で正しく解決されることを固定する。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseCsv } from './csv-import.ts'
import {
  resolveHausudo,
  resolveColumnMapping,
  matchesHausudoFingerprint,
  buildColumnMappingV3,
  PRICE_TARGETS,
  UnknownPresetError,
} from './presets.ts'
import { extractRows } from './row-extract.ts'

const FIXTURE_PATH = new URL(
  '../../../docs/specs/hausudo_customer_headers_fixture_v1.csv',
  import.meta.url,
)

function loadFixture(): { header: string[]; dataRows: string[][] } {
  const rows = parseCsv(readFileSync(FIXTURE_PATH, 'utf8'))
  return { header: rows[0], dataRows: rows.slice(1) }
}

test('resolveHausudo: 174 列の各ターゲットが正しい列 index に解決される', () => {
  const { header } = loadFixture()
  assert.equal(header.length, 174)
  const { targets } = resolveHausudo(header, 'preset:hausudo')

  // 永続化する列（0 始まり index）。
  assert.deepEqual(targets.external_id, [0]) // 顧客番号(1)
  assert.deepEqual(targets.customer_name, [3]) // 顧客名(4)（「顧客名フリガナ」は別 exact）
  assert.deepEqual(targets.category, [10]) // 顧客種別(11)
  assert.deepEqual(targets.address, [40, 41, 42]) // 都道府県(41)+市区(42)+住所(43)
  assert.deepEqual(targets.inquiry_at, [17]) // 受付日(18)
  assert.deepEqual(targets.last_contact_at, [125]) // 更新日(126)＝暫定ソートキー(O43)
  assert.deepEqual(targets.desired_school, [114]) // マッチング小学校(115)

  // 解決＋テストのみ（永続化は PR-D）。
  assert.deepEqual(targets.desired_junior_school, [115]) // マッチング中学校(116)
  assert.deepEqual(targets.desired_muni_code_5, [40, 112]) // 都道府県(41)+マッチング市区(113)
  assert.deepEqual(targets.rank, [36]) // 顧客ランク(37)
  assert.deepEqual(targets.status, [72]) // 顧客ステータス(73)
  assert.deepEqual(targets.price_low_used_house, [98]) // 中古戸建 下限(99)
  assert.deepEqual(targets.price_high_used_house, [99]) // 中古戸建 上限(100)
})

test('resolveHausudo: O49 の誤検出を排除する（同名列・ID 列の取り違え）', () => {
  const { header } = loadFixture()
  const { targets } = resolveHausudo(header, 'preset:hausudo')

  // 「反響媒体」は col15/col16 に 2 回。1 個目（index 14）を採る。
  assert.deepEqual(targets.media, [14])
  // 「担当」の部分一致で拾いがちな「店舗営業担当者ID」(col8=index7) ではなく、
  //   完全一致の「店舗営業担当者」(col9=index8) を採る。
  assert.deepEqual(targets.assignee, [8])
})

test('resolveColumnMapping + extractRows: ゴールデン行の値が正しく解決される', () => {
  const { header, dataRows } = loadFixture()
  const resolved = resolveColumnMapping(header, 'hausudo')
  assert.equal(resolved.route, 'preset:hausudo')

  const out = extractRows(dataRows, resolved.mapping, resolved.extract)
  assert.equal(out.length, 1)
  const r = out[0]

  // external_id は文字列のまま（数値変換を通さない）。
  assert.equal(r.external_id, '9990001')
  assert.equal(typeof r.external_id, 'string')
  // 住所は 3 列の結合（正規化前）。normalizeJpAddress は突合エンジン側。
  assert.equal(r.address_raw, '愛知県岡崎市上三ツ木町八ツ田2')
  // 小学校区（中学校区は本 PR では保持しない）。
  assert.equal(r.desired_school, '六ッ美中部小学校')
  assert.equal(r.category, '買主')
  assert.equal(r.media, 'ポータルサイト')
  assert.equal(r.inquiry_at, '2026-08-01T00:00:00Z') // 受付日
  assert.equal(r.last_contact_at, '2026-08-10T12:00:00Z') // 更新日（暫定ソートキー）
  // 担当（店舗営業担当者）は空欄なので null。ID 列を取り違えていないことの裏付けにもなる。
  assert.equal(r.assignee, null)
  // desired_muni_code_5 は「岡崎市」（市区名）を書き込まない（PR-D で name→code 変換）。
  assert.equal(r.desired_muni_code_5, null)
})

test('resolveColumnMapping: ヘッダ指紋で自動判定する（?preset 指定なし・列数は見ない）', () => {
  const { header } = loadFixture()
  assert.equal(matchesHausudoFingerprint(header), true)

  const resolved = resolveColumnMapping(header)
  assert.equal(resolved.route, 'fingerprint:hausudo')
  assert.ok(resolved.preset) // フル解決が付く
  assert.deepEqual(resolved.extract.addressColumns, [40, 41, 42])
  assert.equal(resolved.extract.schoolColumn, 114)

  // 列数（174）に依存しない: 署名列を保ったまま 1 列削っても指紋は一致する。
  const trimmed = header.slice(0, 173)
  assert.equal(matchesHausudoFingerprint(trimmed), true)
})

test('resolveColumnMapping: 未知の presetId は例外（黙って heuristic に落とさない）', () => {
  const { header } = loadFixture()
  assert.throws(
    () => resolveColumnMapping(header, 'unknown-format'),
    (err: unknown) => err instanceof UnknownPresetError,
  )
})

test('resolveHausudo: composite の必須列（住所）が欠けたら address は未解決（部分解決を握り潰さない）', () => {
  // 「住所」列だけ無いハウスドゥ相当のヘッダ（署名列は保持）。
  const header = [
    '顧客番号',
    'FC名',
    '顧客種別',
    '都道府県',
    '市区', // ← 「住所」列が無い
    'マッチング小学校',
    'マッチング中学校',
  ]
  const { targets } = resolveHausudo(header, 'preset:hausudo')
  // 都道府県/市区は在るが必須の「住所」が欠けるため address は未解決。
  assert.equal(targets.address, undefined)
})

test('resolveColumnMapping: 住所が未解決なら route の必須チェックが働く（address 不成立）', () => {
  const header = ['顧客番号', 'FC名', '顧客種別', '都道府県', '市区', 'マッチング小学校', 'マッチング中学校']
  const resolved = resolveColumnMapping(header, 'hausudo')
  // route.ts の必須チェック相当: mapping.address == null かつ addressColumns も空。
  assert.equal(resolved.mapping.address, undefined)
  assert.ok(!resolved.extract.addressColumns?.length)
})

test('resolveHausudo: 「マッチング市区」だけで「都道府県」が無いと desired_muni_code_5 は未解決', () => {
  // 都道府県を欠いたヘッダ（PR-D の複合キー変換は両列必須のため片方だけは許さない）。
  const header = ['顧客番号', 'FC名', '顧客種別', '住所', 'マッチング市区', 'マッチング小学校', 'マッチング中学校']
  const { targets } = resolveHausudo(header, 'preset:hausudo')
  assert.equal(targets.desired_muni_code_5, undefined)
})

test('resolveColumnMapping: 非ハウスドゥのヘッダは既存 heuristic にフォールバックする', () => {
  const header = ['反響日時', '顧客名', '反響媒体', '住所', '電話', '種別', '担当']
  assert.equal(matchesHausudoFingerprint(header), false)

  const resolved = resolveColumnMapping(header)
  assert.equal(resolved.route, 'fallback:heuristic')
  assert.equal(resolved.preset, null)
  // 既存キーワード検出の結果（住所は index 3）。
  assert.equal(resolved.mapping.address, 3)
  // フォールバックでは複合住所/小学校の補助は付かない。
  assert.equal(resolved.extract.addressColumns, undefined)
  assert.equal(resolved.extract.schoolColumn, undefined)
})

// ── 購入希望マッチ（BM-2 / c3）────────────────────────────────────────
test('resolveHausudo: BM-2 の列（物件種別・価格6組・面積4列）が正しい index に解決される', () => {
  const { header } = loadFixture()
  const { targets } = resolveHausudo(header, 'preset:hausudo')

  // 物件種別（列番号は 1 始まり・index は -1）。
  assert.deepEqual(targets.property_type, [95]) // マッチング物件種別(96)
  assert.deepEqual(targets.sell_property_type, [149]) // 物件種別(150)

  // 価格 6 組（列97〜108）。下限→上限の順に 2 列ずつ並ぶ。
  assert.deepEqual(targets.price_low_new_house, [96]) // 新築戸建 下限(97)
  assert.deepEqual(targets.price_high_commercial, [107]) // 事業用 上限(108)

  // 面積 4 列（列109〜112）。土地が先、専有が後。
  assert.deepEqual(targets.desired_land_area_min, [108]) // マッチング土地面積下限(109)
  assert.deepEqual(targets.desired_land_area_max, [109]) // マッチング土地面積上限(110)
  assert.deepEqual(targets.desired_floor_area_min, [110]) // マッチング専有面積下限(111)
  assert.deepEqual(targets.desired_floor_area_max, [111]) // マッチング専有面積上限(112)
})

test('resolveHausudo: 「物件種別」と「マッチング物件種別」は exact なので取り違えない（O49）', () => {
  const { header } = loadFixture()
  const { targets } = resolveHausudo(header, 'preset:hausudo')
  // 部分一致なら '物件種別' が 'マッチング物件種別' を拾ってしまう。exact なので別列になる。
  assert.notDeepEqual(targets.property_type, targets.sell_property_type)
  assert.equal(header[targets.property_type![0]], 'マッチング物件種別')
  assert.equal(header[targets.sell_property_type![0]], '物件種別')
})

test('resolveColumnMapping: extract に BM-2 の列（price/area）が code 単位で入る', () => {
  const { header } = loadFixture()
  const { extract } = resolveColumnMapping(header, 'hausudo')

  assert.equal(extract.propertyTypeColumn, 95)
  assert.equal(extract.sellPropertyTypeColumn, 149)
  // 価格は property_types.code をキーに持つ（preset の target 名ではない）。
  assert.deepEqual(extract.priceColumns, {
    new_detached: { min: 96, max: 97 },
    used_detached: { min: 98, max: 99 },
    new_condo: { min: 100, max: 101 },
    used_condo: { min: 102, max: 103 },
    land: { min: 104, max: 105 },
    commercial: { min: 106, max: 107 },
  })
  assert.deepEqual(extract.landAreaColumns, { min: 108, max: 109 })
  assert.deepEqual(extract.floorAreaColumns, { min: 110, max: 111 })
})

test('PRICE_TARGETS: 6 種別ぶん・target 名と code の対応が唯一の定義として揃っている', () => {
  assert.equal(PRICE_TARGETS.length, 6)
  assert.deepEqual(
    PRICE_TARGETS.map((t) => t.code),
    ['new_detached', 'used_detached', 'new_condo', 'used_condo', 'land', 'commercial'],
  )
  // 既存の target 名はリネームしない（裁定2）。対応表だけが両者を橋渡しする。
  const newDetached = PRICE_TARGETS.find((t) => t.code === 'new_detached')!
  assert.equal(newDetached.low, 'price_low_new_house')
  assert.equal(newDetached.high, 'price_high_new_house')
})

test('resolveColumnMapping: heuristic 経路では BM-2 の列を埋めない（列位置の決め打ちをしない）', () => {
  const header = ['顧客番号', '顧客名', '住所', '電話番号']
  const { extract, route } = resolveColumnMapping(header)
  assert.equal(route, 'fallback:heuristic')
  assert.equal(extract.propertyTypeColumn, undefined)
  assert.equal(extract.sellPropertyTypeColumn, undefined)
  assert.equal(extract.priceColumns, undefined)
  assert.equal(extract.floorAreaColumns, undefined)
  assert.equal(extract.landAreaColumns, undefined)
})

test('buildColumnMappingV3: v:2 のキーを保ったまま BM-2 の index を追記する', () => {
  const { header } = loadFixture()
  const { mapping, extract, route } = resolveColumnMapping(header, 'hausudo')
  const m = buildColumnMappingV3(header, mapping, extract, route, 'hausudo')

  // v:2 と同じ意味のキー（名前も値の形も変えない）。
  assert.equal(m.v, 3)
  assert.equal(m.resolve_route, 'preset:hausudo')
  assert.equal(m.preset_id, 'hausudo')
  assert.deepEqual(m.address_columns, ['都道府県', '市区', '住所'])
  assert.equal((m.columns as Record<string, string>).external_id, '顧客番号')

  // BM-2 の追記（0 始まり index）。
  assert.equal(m.propertyTypeColumn, 95)
  assert.equal(m.sellPropertyTypeColumn, 149)
  assert.deepEqual((m.priceColumns as Record<string, unknown>).land, { min: 104, max: 105 })
  assert.deepEqual(m.floorAreaColumns, { min: 110, max: 111 })
  assert.deepEqual(m.landAreaColumns, { min: 108, max: 109 })
})

test('buildColumnMappingV3: 未解決の列はキーごと省略する（null を入れない）', () => {
  const header = ['顧客番号', '顧客名', '住所']
  const { mapping, extract, route } = resolveColumnMapping(header)
  const m = buildColumnMappingV3(header, mapping, extract, route, null)
  assert.equal(m.v, 3)
  for (const k of [
    'propertyTypeColumn',
    'sellPropertyTypeColumn',
    'priceColumns',
    'floorAreaColumns',
    'landAreaColumns',
    'preset_id',
    'address_columns',
  ]) {
    assert.equal(k in m, false, `${k} はキーごと省略されるべき`)
  }
})

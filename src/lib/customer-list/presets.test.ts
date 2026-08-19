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

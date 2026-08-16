// ============================================================
// normalizeJpAddress のユニットテスト（依存ゼロ・Node 標準テストランナー）。
//   実行: npm test （= node --test 'src/**/*.test.ts'）
//
// 出所: Phase6 PoC /Users/gomez/okazaki-mansion-db の
//       tests/test_address_normalize.py（pytest 収集 38ケース）の移植。
//       内訳 = 表記ゆれ26 ＋ 不正/曖昧9 ＋ 単体3（等価表記・戻り値の形・非文字列）。
//
// 移植にあたっての意図的な差分（PoC は岡崎市固定・例外送出だった）:
//   (1) 例外を投げず status で返す（CSV 取込で1行の失敗が全体を止めないため）。
//       PoC の AddressNormalizationError → status='invalid'、TypeError → status='invalid'。
//   (2) 「愛知県豊田市…」は PoC では Unsupported municipality の例外だったが、
//       8市一般化により **正常に正規化される**（23211）へ変更。
//   (3) 「岐阜県岡崎市…」は例外ではなく status='out_of_scope'
//       （市名は8市にあるが都道府県が一致しない＝推測で愛知県に寄せない・原則2）。
//   (4) 「明大寺町1丁目2番3号」（市区町村なし）も out_of_scope。
//
// 追加した回帰（PoC には無い・8市一般化と実データ由来）:
//   - 8市それぞれが正しい muni_code_5 に解決されること
//   - 都道府県アンカー（府中市問題の設計確認）
//   - 漢数字を含む町名「十王町」「百々町」（本番 geo_reference_points に実在）を
//     丁目と誤読しないこと
// ============================================================
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeJpAddress } from './normalize-jp.ts'
import { TARGET_MUNICIPALITIES } from './target-munis.ts'

// ── PoC 26ケース: 岡崎市の表記ゆれ ───────────────────────────────────────
//   [入力, town, chome, ban, go]
const OKAZAKI_VARIANTS: Array<
  [string, string, string | null, string | null, string | null]
> = [
  ['愛知県岡崎市明大寺町1丁目2番3号', '明大寺町', '1', '2', '3'],
  ['岡崎市明大寺町1-2-3', '明大寺町', '1', '2', '3'],
  ['愛知県岡崎市明大寺町１丁目２番３号', '明大寺町', '1', '2', '3'],
  ['愛知県岡崎市明大寺町一丁目二番三号', '明大寺町', '1', '2', '3'],
  ['岡崎市明大寺町一丁目2番地3号', '明大寺町', '1', '2', '3'],
  ['岡崎市明大寺町壱丁目弐番参号', '明大寺町', '1', '2', '3'],
  [' 愛知県　岡崎市 明大寺町 1丁目 2番地の3号 ', '明大寺町', '1', '2', '3'],
  ['岡崎市明大寺町1‐2‐3', '明大寺町', '1', '2', '3'],
  ['愛知県岡崎市康生通一丁目10番5号', '康生通', '1', '10', '5'],
  ['岡崎市康生通1丁目10-5', '康生通', '1', '10', '5'],
  ['愛知県岡崎市康生通1-10-5', '康生通', '1', '10', '5'],
  ['愛知県岡崎市本町通2番3号', '本町通', null, '2', '3'],
  ['岡崎市本町通2番地の3', '本町通', null, '2', '3'],
  ['岡崎市本町通2-3', '本町通', null, '2', '3'],
  ['愛知県岡崎市材木町12番地', '材木町', null, '12', null],
  ['岡崎市材木町１２', '材木町', null, '12', null],
  ['愛知県岡崎市材木町', '材木町', null, null, null],
  ['岡崎市伝馬通三丁目', '伝馬通', '3', null, null],
  ['愛知県岡崎市伝馬通3丁目7番', '伝馬通', '3', '7', null],
  ['岡崎市伝馬通3丁目7', '伝馬通', '3', '7', null],
  ['愛知県岡崎市六供町4番5号', '六供町', null, '4', '5'],
  ['岡崎市六供町4番地5号', '六供町', null, '4', '5'],
  ['岡崎市六供町四番地の五', '六供町', null, '4', '5'],
  [' 愛知県 岡崎市 六供町 4－5 ', '六供町', null, '4', '5'],
  ['愛知県岡﨑市明大寺町1丁目2番3号', '明大寺町', '1', '2', '3'],
  ['岡崎市明大寺町十一丁目二十番三号', '明大寺町', '11', '20', '3'],
]

test('PoC移植: 岡崎市の表記ゆれ26ケースが同じ構造へ正規化される', () => {
  assert.equal(OKAZAKI_VARIANTS.length, 26, 'PoC のパラメトライズ件数と一致すること')

  for (const [raw, town, chome, ban, go] of OKAZAKI_VARIANTS) {
    const r = normalizeJpAddress(raw)
    assert.equal(r.status, 'normalized', raw)
    assert.equal(r.prefecture, '愛知県', raw)
    assert.equal(r.prefCode, '23', raw)
    assert.equal(r.municipality, '岡崎市', raw)
    assert.equal(r.muniCode5, '23202', raw)
    assert.equal(r.town, town, raw)
    assert.equal(r.chome, chome, raw)
    assert.equal(r.ban, ban, raw)
    assert.equal(r.go, go, raw)
    assert.equal(
      r.normalizationKey,
      ['23202', town, chome ?? '', ban ?? '', go ?? ''].join('|'),
      raw,
    )
    assert.equal(r.reason, null, raw)
  }
})

// ── PoC 9ケース: 不正・曖昧・対象外 ─────────────────────────────────────
test('PoC移植: 空文字・空白のみは invalid', () => {
  for (const raw of ['', '　 ']) {
    const r = normalizeJpAddress(raw)
    assert.equal(r.status, 'invalid', JSON.stringify(raw))
    assert.ok(r.reason)
  }
})

test('PoC移植: 町字名が無い住所は invalid', () => {
  const r = normalizeJpAddress('愛知県岡崎市')
  assert.equal(r.status, 'invalid')
  assert.equal(r.town, null)
})

test('PoC移植: 数値表記が破綻した住所は invalid（推測で補完しない）', () => {
  const cases = [
    '岡崎市明大寺町1-2-3-4', // 4要素は解釈できない
    '岡崎市明大寺町1丁目2番3号ABC', // 末尾に余計な文字
    '岡崎市明大寺町0丁目2番3号', // 0丁目は住所として認めない
  ]
  for (const raw of cases) {
    const r = normalizeJpAddress(raw)
    assert.equal(r.status, 'invalid', raw)
    assert.equal(r.normalizationKey, null, raw)
  }
})

test('移植時の意図的変更: 都道府県が一致しない同名市は out_of_scope（例外にしない）', () => {
  const r = normalizeJpAddress('岐阜県岡崎市明大寺町1丁目2番3号')
  assert.equal(r.status, 'out_of_scope')
  assert.equal(r.muniCode5, null)
  assert.ok(r.reason?.includes('岡崎市'))
})

test('移植時の意図的変更: 市区町村が無い住所は out_of_scope', () => {
  const r = normalizeJpAddress('明大寺町1丁目2番3号')
  assert.equal(r.status, 'out_of_scope')
  assert.equal(r.muniCode5, null)
})

test('移植時の意図的変更: 豊田市は8市一般化により正規化される（PoCでは例外）', () => {
  const r = normalizeJpAddress('愛知県豊田市明大寺町1丁目2番3号')
  assert.equal(r.status, 'normalized')
  assert.equal(r.muniCode5, '23211')
  assert.equal(r.municipality, '豊田市')
})

// ── PoC 単体3ケース ────────────────────────────────────────────────────
test('PoC移植: 等価な表記は同一の正準表記・突合キーになる', () => {
  const variants = [
    '愛知県岡崎市明大寺町1丁目2番3号',
    '岡崎市明大寺町1-2-3',
    '愛知県岡崎市明大寺町一丁目二番三号',
    '岡崎市明大寺町１丁目２番地の３号',
  ]
  const results = variants.map(normalizeJpAddress)

  assert.deepEqual(
    new Set(results.map((r) => r.addressCanonical)),
    new Set(['愛知県岡崎市明大寺町1丁目2番地3号']),
  )
  assert.deepEqual(
    new Set(results.map((r) => r.normalizationKey)),
    new Set(['23202|明大寺町|1|2|3']),
  )
})

test('PoC移植: 戻り値の形（JSON シリアライズ可能な素の値のみ）', () => {
  const r = normalizeJpAddress('岡崎市明大寺町1-2-3')
  assert.deepEqual(r, {
    status: 'normalized',
    addressNormalized: '岡崎市明大寺町1-2-3',
    prefecture: '愛知県',
    prefCode: '23',
    municipality: '岡崎市',
    muniCode5: '23202',
    town: '明大寺町',
    chome: '1',
    ban: '2',
    go: '3',
    addressCanonical: '愛知県岡崎市明大寺町1丁目2番地3号',
    normalizationKey: '23202|明大寺町|1|2|3',
    candidates: [],
    reason: null,
  })
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r)
})

test('PoC移植: 文字列以外・null・undefined は invalid（例外を投げない）', () => {
  for (const raw of [null, undefined, 123 as unknown as string]) {
    const r = normalizeJpAddress(raw)
    assert.equal(r.status, 'invalid')
    assert.equal(r.addressNormalized, '')
  }
})

// ── 追加回帰: 8市一般化 ────────────────────────────────────────────────
test('8市すべてが正しい muni_code_5 へ解決される', () => {
  assert.equal(TARGET_MUNICIPALITIES.length, 8)
  for (const m of TARGET_MUNICIPALITIES) {
    const r = normalizeJpAddress(`${m.prefName}${m.muniName}中町1丁目2番3号`)
    assert.equal(r.status, 'normalized', m.muniName)
    assert.equal(r.muniCode5, m.muniCode5, m.muniName)
    assert.equal(r.prefCode, m.prefCode, m.muniName)
    assert.equal(r.town, '中町', m.muniName)
  }
})

test('都道府県を省略しても8市は一意に解決される（現辞書に同名衝突なし）', () => {
  const r = normalizeJpAddress('鹿児島市城山町1番1号')
  assert.equal(r.status, 'normalized')
  assert.equal(r.muniCode5, '46201')
  assert.equal(r.ban, '1')
  assert.equal(r.go, '1')
})

test('対象8市以外の市区町村は out_of_scope（断定しない）', () => {
  for (const raw of ['愛知県名古屋市中区栄3丁目1番1号', '東京都府中市宮西町2丁目24番']) {
    const r = normalizeJpAddress(raw)
    assert.equal(r.status, 'out_of_scope', raw)
    assert.equal(r.muniCode5, null, raw)
  }
})

// ── 追加回帰: 漢数字を含む町名（本番 geo_reference_points に実在）────────────
test('漢数字を含む町名を丁目と誤読しない（十王町・百々町）', () => {
  const noChome = normalizeJpAddress('愛知県豊田市百々町7番地')
  assert.equal(noChome.status, 'normalized')
  assert.equal(noChome.town, '百々町')
  assert.equal(noChome.chome, null)
  assert.equal(noChome.ban, '7')

  const withChome = normalizeJpAddress('愛知県豊橋市十王町一丁目2番3号')
  assert.equal(withChome.status, 'normalized')
  assert.equal(withChome.town, '十王町')
  assert.equal(withChome.chome, '1')
  assert.equal(withChome.ban, '2')
  assert.equal(withChome.go, '3')
})

test('丁目が明示されない2要素は 番地-号 と読む（丁目-番地 と推測しない）', () => {
  const r = normalizeJpAddress('岡崎市本町通2-3')
  assert.equal(r.chome, null)
  assert.equal(r.ban, '2')
  assert.equal(r.go, '3')
})

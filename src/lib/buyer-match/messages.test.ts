// =====================================================================
// PR-BM-7 c6: 表示文言（messages.ts）の逐語テスト（裁定34/30）。
//   ⛔ 1文字も変えない。文言を編集したらこのテストが落ちる＝PM 裁定なしの
//     変更を構造的に止める。
// =====================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import { BUYER_MATCH_MESSAGES, BUYER_MATCH_ORG_MESSAGES } from './messages.ts'

test('見出し2つ（裁定34・逐語）', () => {
  assert.equal(BUYER_MATCH_MESSAGES.wideHeading, 'この市区町村で同じ種別をお探しの方')
  assert.equal(BUYER_MATCH_MESSAGES.nearHeading, 'うち、ご想定の価格帯と重なる方')
})

test('抑止時の代替文言2つ（裁定34・逐語）', () => {
  assert.equal(
    BUYER_MATCH_MESSAGES.suppressedWide,
    '該当する購入希望が少なく、人数を表示できません（5名未満）',
  )
  assert.equal(
    BUYER_MATCH_MESSAGES.suppressedNear,
    '価格帯が重なる方が少なく、人数を表示できません（5名未満）',
  )
})

test('内訳0件・7件目以降（裁定34・逐語）', () => {
  assert.equal(BUYER_MATCH_MESSAGES.cellsEmpty, '表示できる内訳がありません（各区分5名未満のため）')
  assert.equal(BUYER_MATCH_MESSAGES.cellsOverflow, 'ほか')
})

test('免責（裁定30・逐語）', () => {
  assert.equal(
    BUYER_MATCH_MESSAGES.disclaimer,
    '※ 当社が直近12ヶ月に受け付けたお問い合わせのうち、ご条件に近いものを集計した参考値です。個人を特定する情報は含みません。5名未満の区分は表示していません。売却を保証するものではありません。',
  )
})

test('物件種別の取得失敗文言は code を含まない（裁定35）', () => {
  assert.equal(BUYER_MATCH_MESSAGES.propertyTypesFailed, '物件種別を取得できませんでした')
  for (const code of ['new_detached', 'used_detached', 'new_condo', 'used_condo', 'land', 'commercial']) {
    assert.equal(BUYER_MATCH_MESSAGES.propertyTypesFailed.includes(code), false)
  }
})

// ---------------------------------------------------------------------
// PR-BM-10c: org モードの文言（裁定-bm-L・逐語）。
//   ⛔ near/wide の見出しは既存 BUYER_MATCH_MESSAGES を流用し、org 用に別文言を
//     作らない（裁定41）。ここで新設した6定数以外を足したらこのテストで気づける。
// ---------------------------------------------------------------------
test('org モードの文言6つ（裁定-bm-L・逐語）', () => {
  assert.equal(BUYER_MATCH_ORG_MESSAGES.orgHeading, 'この条件で住まいをお探しの方')
  assert.equal(
    BUYER_MATCH_ORG_MESSAGES.orgEmpty,
    '条件を選んで「表示する」を押すと、その条件で住まいをお探しの方の人数を表示します。',
  )
  assert.equal(
    BUYER_MATCH_ORG_MESSAGES.orgAreasEmpty,
    '対象の市区町村がありません。名簿を取り込むと候補が表示されます。',
  )
  assert.equal(BUYER_MATCH_ORG_MESSAGES.backToCustomers, '顧客アタックリストへ戻る')
  assert.equal(BUYER_MATCH_ORG_MESSAGES.orgButton, '購入希望マッチ')
  assert.equal(BUYER_MATCH_ORG_MESSAGES.orgSubmit, '表示する')
})

test('org モードは near/wide 見出しを新設しない（裁定41・既存流用）', () => {
  // org 用に独自の near/wide 見出しキーを作っていないこと（裁定41）。
  assert.equal('orgNearHeading' in BUYER_MATCH_ORG_MESSAGES, false)
  assert.equal('orgWideHeading' in BUYER_MATCH_ORG_MESSAGES, false)
})

test('提示モードの文言2つ（仮番 -bm-M／A3・逐語）', () => {
  assert.equal(BUYER_MATCH_ORG_MESSAGES.presentButton, '提示する')
  assert.equal(BUYER_MATCH_ORG_MESSAGES.presentBackToEdit, '編集に戻る')
})

// ============================================================
// PR-BM-7: 購入希望マッチ 売主向けシートの表示文言（逐語・単一の真実源）。
//   ⛔ 1文字も変えない（裁定34・裁定30）。画面（BuyerMatchPanel）と
//     PDF（seller-sheet/document.tsx）が同じ定数を参照し、片方だけ文言が
//     ズレることを構造的に防ぐ。
//   ⚠ 既存の CustomersClient.tsx:1291（校区ヒートマップの注記）とは別文言。
//     あちらは校区の濃淡についての注記であり、こちらは買い希望の集計に
//     ついての注記。片方を他方に寄せない（裁定34）。
//   ⚠ 外部 import を持たない（node --test で直接読める純モジュール）。
// ============================================================

export const BUYER_MATCH_MESSAGES = {
  // 大きな数字2つの見出し。
  //   ⚠ v1 は校区で絞らない（裁定33・案A）ため、near は「校区が近い方」ではなく
  //     「価格帯が重なる方」。文言はその帰結に合わせてある（裁定34）。
  wideHeading: 'この市区町村で同じ種別をお探しの方',
  nearHeading: 'うち、ご想定の価格帯と重なる方',

  // k=5 抑止（suppressed_wide / suppressed_near が true）のときの代替文言。
  //   ⛔ このとき数値は1つも描画しない。
  suppressedWide: '該当する購入希望が少なく、人数を表示できません（5名未満）',
  suppressedNear: '価格帯が重なる方が少なく、人数を表示できません（5名未満）',

  // 内訳カードが0件（＝各区分が k=5 未満で RPC が行ごと返さない）ときの文言。
  cellsEmpty: '表示できる内訳がありません（各区分5名未満のため）',

  // 内訳カード7件目以降。⛔ 残り件数を出さない（裁定34）。
  cellsOverflow: 'ほか',

  // 免責（裁定30・逐語）。画面・PDF の各ページに必ず1つ置く。
  disclaimer:
    '※ 当社が直近12ヶ月に受け付けたお問い合わせのうち、ご条件に近いものを集計した参考値です。個人を特定する情報は含みません。5名未満の区分は表示していません。売却を保証するものではありません。',

  // 物件種別マスタ（property_types）の取得に失敗したとき（裁定35）。
  //   ⛔ code（new_detached 等）をそのまま画面に出さない。
  propertyTypesFailed: '物件種別を取得できませんでした',
} as const

export type BuyerMatchMessageKey = keyof typeof BUYER_MATCH_MESSAGES

// ============================================================
// PR-BM-9b-2: 匿名カードの専用画面（/customers/buyer-match）の表示文言。
//   ⛔ JSX に直書きしない（裁定70）。画面・ボタン・見出しはすべてここを参照する。
//   ⚠ heading* はプレースホルダ（{min}/{max}/{type}/{muni}）を持つテンプレート。
//     補間は display.ts の buildBuyerCardsHeading が担う（messages は文言だけを持ち、
//     数値整形・分岐ロジックを持たない＝BM-7 の formatPriceBucket と同じ責務分割）。
//   ⚠ 見出しは used_conditions の「どのフィールドが非 null か」で選ぶ（裁定73）。
//     ⛔ stage 数値・「段」等の内部用語を文言に含めない（裁定73/75）。
//   ・rowFloorArea / rowLandArea / rowDistricts はカード本体の行ラベル。裁定76 が
//     専有面積・土地面積・校区の行を要求するため、その dt ラベルを文言として置く
//     （JSX 直書きを避けるため）。⛔ 間取り・反響種別のラベルは作らない（裁定76）。
//   ・抑止時文言は PP §9-4 で対外公表済みの数字（5名未満）を含む確定文言。
// ============================================================
export const BUYER_MATCH_CARDS_MESSAGES = {
  // 売主向けシートに出すボタン（裁定70）。⛔ 他社サービス名に似せない。
  button: '買い手を見る',

  // 見出し（裁定73・used_conditions 由来）。{type}=物件種別 label_ja／{muni}=市区町村名。
  headingPriceRange: '{min}〜{max}万円で{type}をお探しの方', // 段1/2（下限・上限とも）
  headingPriceMax: '{max}万円までで{type}をお探しの方', // 上限のみ
  headingPriceMin: '{min}万円以上で{type}をお探しの方', // 下限のみ
  headingTypeOnly: '{type}をお探しの方', // 段3（価格を外した段）
  headingMuniOnly: '{muni}で住まいをお探しの方', // 段4（種別も外した段）

  // suppressed=true または stage=null のとき、カード領域の代わりに出す（裁定72）。
  suppressed: '条件に近い購入検討者は、現在5名未満のため表示していません。',

  // 値が null のとき（種別・市区町村名が解決できない等）の代替（裁定・値なし）。
  valueNone: '指定なし',

  // カード本体の行ラベル（裁定76/81）。
  //   ⚠ rowPrice は「購入検討者本人の希望予算」（裁定81）。見出しの価格（売主の検索条件＝
  //     査定物件の想定価格帯）とは別物。カードの主役の行としてバッジ直下・面積より上に置く。
  rowPrice: '希望予算',
  rowFloorArea: '専有面積',
  rowLandArea: '土地面積',
  rowDistricts: '校区',
} as const

export type BuyerMatchCardsMessageKey = keyof typeof BUYER_MATCH_CARDS_MESSAGES

// ============================================================
// PR-BM-10c: 購入希望マッチ org モード（/customers/buyer-match?list なし）の文言。
//   ⛔ 新設するのは裁定-bm-L および仮番 -bm-M（A3）の定数のみ（ここに列挙した以外を足さない）。
//   ⛔ near/wide の見出しは BUYER_MATCH_MESSAGES.nearHeading / wideHeading を
//     流用する（org 用に別文言を作らない・裁定41）。名簿モードの文言は1文字も変えない。
//   ・backToCustomers は両モード共通の戻るリンク文言（裁定-bm-E）。名簿モード・org
//     モードの BackLink がともにこの定数を参照する。
//   ⚠ 外部 import を持たない（node --test で直接読める純モジュール）。
// ============================================================
export const BUYER_MATCH_ORG_MESSAGES = {
  // 上段（条件ボックス）の見出し（裁定-bm-D／裁定-bm-L）。
  orgHeading: 'この条件で住まいをお探しの方',

  // 条件未入力（URL に条件が無い）ときに結果領域へ出す案内（裁定-bm-L）。
  orgEmpty: '条件を選んで「表示する」を押すと、その条件で住まいをお探しの方の人数を表示します。',

  // org 版 areas が空（名簿がまだ無い等）のときの市区町村セレクトの代替（裁定-bm-L）。
  orgAreasEmpty: '対象の市区町村がありません。名簿を取り込むと候補が表示されます。',

  // 戻るリンク（裁定-bm-E・両モード共通・href=/customers）。
  backToCustomers: '顧客アタックリストへ戻る',

  // /customers の ListIndex に置くボタン（裁定-bm-F）。
  orgButton: '購入希望マッチ',

  // 条件フォームの送信ボタン（裁定-bm-L）。
  orgSubmit: '表示する',

  // 提示モード（?present=1・仮番 -bm-M／A3）。編集モードから提示モードへ入るリンク。
  presentButton: '提示する',

  // 提示モードから編集モードへ戻るリンク（仮番 -bm-M／A3）。
  presentBackToEdit: '編集に戻る',
} as const

export type BuyerMatchOrgMessageKey = keyof typeof BUYER_MATCH_ORG_MESSAGES

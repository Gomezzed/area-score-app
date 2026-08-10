// ============================================================
// 都道府県マスタ（name → code）— 突合の「都道府県アンカー」用の定数。
//   全国地方公共団体コードの都道府県2桁（'01'〜'47'）。
//   これらは public.prefectures テーブルの seed（code, name）と一致させてある
//   （src の別途DB往復を増やさず、純ロジックの突合エンジンを自己完結させる）。
//   ⚠ municipalities.prefecture_code は prefectures(code) への FK。ここの code は
//     必ずその値と一致する（seed から転記・推測しない）。
//
//   使途: 住所文字列の先頭に含まれる都道府県名を検出し、自治体候補を
//         その都道府県に限定してから最長一致する（府中市問題の解消）。
// ============================================================

// name は正規化前の表記。normalizeAddress は NFKC/旧字体/ハイフン/空白を
// 触るが都道府県名（純漢字）は不変なので、正規化後の住所ともそのまま一致する。
export const PREFECTURES: ReadonlyArray<{ code: string; name: string }> = [
  { code: '01', name: '北海道' },
  { code: '02', name: '青森県' },
  { code: '03', name: '岩手県' },
  { code: '04', name: '宮城県' },
  { code: '05', name: '秋田県' },
  { code: '06', name: '山形県' },
  { code: '07', name: '福島県' },
  { code: '08', name: '茨城県' },
  { code: '09', name: '栃木県' },
  { code: '10', name: '群馬県' },
  { code: '11', name: '埼玉県' },
  { code: '12', name: '千葉県' },
  { code: '13', name: '東京都' },
  { code: '14', name: '神奈川県' },
  { code: '15', name: '新潟県' },
  { code: '16', name: '富山県' },
  { code: '17', name: '石川県' },
  { code: '18', name: '福井県' },
  { code: '19', name: '山梨県' },
  { code: '20', name: '長野県' },
  { code: '21', name: '岐阜県' },
  { code: '22', name: '静岡県' },
  { code: '23', name: '愛知県' },
  { code: '24', name: '三重県' },
  { code: '25', name: '滋賀県' },
  { code: '26', name: '京都府' },
  { code: '27', name: '大阪府' },
  { code: '28', name: '兵庫県' },
  { code: '29', name: '奈良県' },
  { code: '30', name: '和歌山県' },
  { code: '31', name: '鳥取県' },
  { code: '32', name: '島根県' },
  { code: '33', name: '岡山県' },
  { code: '34', name: '広島県' },
  { code: '35', name: '山口県' },
  { code: '36', name: '徳島県' },
  { code: '37', name: '香川県' },
  { code: '38', name: '愛媛県' },
  { code: '39', name: '高知県' },
  { code: '40', name: '福岡県' },
  { code: '41', name: '佐賀県' },
  { code: '42', name: '長崎県' },
  { code: '43', name: '熊本県' },
  { code: '44', name: '大分県' },
  { code: '45', name: '宮崎県' },
  { code: '46', name: '鹿児島県' },
  { code: '47', name: '沖縄県' },
]

// 住所（正規化後）の先頭から都道府県を検出し code を返す。無ければ null。
//   先頭一致に限定するのは「東京都」に含まれる「京都」等の部分一致誤検出を避けるため。
//   都道府県名は末尾（都/道/府/県）まで含む一意な表記なので取り違えは起きない。
export function detectPrefectureCode(normAddr: string): string | null {
  for (const p of PREFECTURES) {
    if (normAddr.startsWith(p.name)) return p.code
  }
  return null
}

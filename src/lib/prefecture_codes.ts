/**
 * ============================================================================
 *  src/lib/prefecture_codes.ts
 *  47都道府県の JIS コード (e-Stat 統計コード) マッピング
 * ============================================================================
 *  既存の src/lib/regions.ts (PrefInfo) は触らず、こちらで JIS コードを補完。
 *  全国47都道府県横展開時に常にここを参照すれば良い設計。
 * ============================================================================
 */

/** name_en → JIS 都道府県コード (2桁文字列) */
export const PREF_CODE_BY_NAME_EN: Record<string, string> = {
  hokkaido:  '01',
  aomori:    '02',
  iwate:     '03',
  sendai:    '04',   // 宮城県 (name_en="sendai" は既存命名規則を踏襲)
  akita:     '05',
  yamagata:  '06',
  fukushima: '07',
  ibaraki:   '08',
  tochigi:   '09',
  gunma:     '10',
  saitama:   '11',
  chiba:     '12',
  tokyo:     '13',
  kanagawa:  '14',
  niigata:   '15',
  toyama:    '16',
  ishikawa:  '17',
  fukui:     '18',
  yamanashi: '19',
  nagano:    '20',
  gifu:      '21',
  shizuoka:  '22',
  aichi:     '23',
  mie:       '24',
  shiga:     '25',
  kyoto:     '26',
  osaka:     '27',
  hyogo:     '28',
  nara:      '29',
  wakayama:  '30',
  tottori:   '31',
  shimane:   '32',
  okayama:   '33',
  hiroshima: '34',
  yamaguchi: '35',
  tokushima: '36',
  kagawa:    '37',
  ehime:     '38',
  kochi:     '39',
  fukuoka:   '40',
  saga:      '41',
  nagasaki:  '42',
  kumamoto:  '43',
  oita:      '44',
  miyazaki:  '45',
  kagoshima: '46',
  okinawa:   '47',
}

/** 逆引き: JIS コード → name_en */
export const NAME_EN_BY_PREF_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(PREF_CODE_BY_NAME_EN).map(([k, v]) => [v, k]),
)

/** name_en → 漢字略称 (例: kagoshima → "鹿児島県") */
export const PREF_NAME_BY_NAME_EN: Record<string, string> = {
  hokkaido: '北海道', aomori: '青森県', iwate: '岩手県', sendai: '宮城県',
  akita: '秋田県', yamagata: '山形県', fukushima: '福島県',
  ibaraki: '茨城県', tochigi: '栃木県', gunma: '群馬県',
  saitama: '埼玉県', chiba: '千葉県', tokyo: '東京都', kanagawa: '神奈川県',
  niigata: '新潟県', toyama: '富山県', ishikawa: '石川県', fukui: '福井県',
  yamanashi: '山梨県', nagano: '長野県',
  gifu: '岐阜県', shizuoka: '静岡県', aichi: '愛知県', mie: '三重県',
  shiga: '滋賀県', kyoto: '京都府', osaka: '大阪府', hyogo: '兵庫県',
  nara: '奈良県', wakayama: '和歌山県',
  tottori: '鳥取県', shimane: '島根県', okayama: '岡山県',
  hiroshima: '広島県', yamaguchi: '山口県',
  tokushima: '徳島県', kagawa: '香川県', ehime: '愛媛県', kochi: '高知県',
  fukuoka: '福岡県', saga: '佐賀県', nagasaki: '長崎県',
  kumamoto: '熊本県', oita: '大分県', miyazaki: '宮崎県',
  kagoshima: '鹿児島県', okinawa: '沖縄県',
}

/**
 * 市区町村 JIS コード (5桁) → 都道府県コード (先頭2桁) の取り出し
 */
export function prefectureCodeFromCityCode(cityCode: string): string {
  return cityCode.slice(0, 2)
}

/**
 * バリデーション: JIS 都道府県コードか
 */
export function isValidPrefectureCode(code: string): boolean {
  return /^[0-4][0-9]$/.test(code) && parseInt(code, 10) >= 1 && parseInt(code, 10) <= 47
}

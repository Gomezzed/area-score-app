// dashboardUrlState の純ロジック（URL 組み立て・pref/city/area 解決）のユニットテスト。
//   実行: npm test （= node --test。Node がネイティブに .ts を型ストリップ実行）
//   純関数のみ検証（React フックの副作用 router.push/replace は対象外）。
//   純モジュールは実行時 import を持たない（型は import type で消去）ため、
//   Node は @/ エイリアスや React/next を解決せずに読み込める。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDashboardUrl,
  resolveActivePref,
  resolveExpandedCity,
  resolveSelectedArea,
} from './dashboardUrlState.ts'
import type { Prefecture, MunicipalityWithStats } from '../types/index.ts'

// ── フィクスチャ ──
function pref(code: string, name: string, name_en: string): Prefecture {
  return { code, name, name_en, region: 'hokkaido', center_lat: null, center_lng: null, zoom_level: 10 }
}
// 本番と一致する実コード（5桁）。神戸市=28100 / 東灘区=28101 / 西区=28111（muni-code.test.ts と突合）
function muni(city_code: string | null, name: string): MunicipalityWithStats {
  return {
    id: `id-${city_code ?? name}`,
    prefecture_code: '28',
    city_code,
    name,
    lat: null,
    lng: null,
    popLatest: null,
    popPrev: null,
    popPrev2: null,
    householdsLatest: null,
    delta: null,
    deltaRate: null,
    stationPassengersTotal: 0,
  }
}

const PREFS: Prefecture[] = [
  pref('01', '北海道', 'hokkaido'),
  pref('13', '東京都', 'tokyo'),
  pref('23', '愛知県', 'aichi'),
  pref('28', '兵庫県', 'hyogo'),
]

// 兵庫県の市区町村（政令市=神戸市＋その行政区、単独市=姫路市）
const HYOGO: MunicipalityWithStats[] = [
  muni('28100', '神戸市'),
  muni('28101', '神戸市東灘区'),
  muni('28111', '神戸市西区'),
  muni('28201', '姫路市'),
]
// 東京都（特別区は「区」単独行・市接頭辞なし）
const TOKYO: MunicipalityWithStats[] = [muni('13101', '千代田区'), muni('13102', '中央区')]
// 愛知県（岡崎市＝単独市）
const AICHI: MunicipalityWithStats[] = [muni('23202', '岡崎市'), muni('23100', '名古屋市'), muni('23106', '名古屋市西区')]

// hook 内 designatedNames 導出と同じロジック（親「市」本体が存在する区を持つ政令市名の集合）。
//   ward 分解は census.ts の parseWard と同一正規表現（純テスト維持のためローカル再実装）。
const WARD_RE = /^(.+?市)(.+区)$/
function deriveDesignated(munis: MunicipalityWithStats[]): Set<string> {
  const cityNames = new Set(munis.map((m) => m.name))
  const s = new Set<string>()
  for (const m of munis) {
    const match = m.name.match(WARD_RE)
    if (match && cityNames.has(match[1])) s.add(match[1])
  }
  return s
}

test('buildDashboardUrl: 順序固定・null は省略・空はパスのみ', () => {
  assert.equal(buildDashboardUrl('/dashboard', 'hyogo', '28100', '28111'), '/dashboard?pref=hyogo&city=28100&area=28111')
  assert.equal(buildDashboardUrl('/dashboard', 'aichi', null, '23202'), '/dashboard?pref=aichi&area=23202')
  assert.equal(buildDashboardUrl('/dashboard', 'hyogo', '28100', null), '/dashboard?pref=hyogo&city=28100')
  assert.equal(buildDashboardUrl('/dashboard', null, null, null), '/dashboard')
})

test('resolveActivePref: 有効 name_en を解決', () => {
  assert.equal(resolveActivePref('aichi', PREFS)?.code, '23')
  assert.equal(resolveActivePref('hyogo', PREFS)?.code, '28')
})

test('resolveActivePref: 未知/欠落は北海道（先頭県）へフォールバック', () => {
  assert.equal(resolveActivePref('xxx', PREFS)?.code, '01')
  assert.equal(resolveActivePref(null, PREFS)?.code, '01')
})

test('resolveActivePref: prefectures 未ロードは undefined', () => {
  assert.equal(resolveActivePref('aichi', []), undefined)
})

test('resolveExpandedCity: 政令市本体コード → 市名', () => {
  const designated = deriveDesignated(HYOGO)
  assert.equal(resolveExpandedCity('28100', HYOGO, designated), '神戸市')
})

test('resolveExpandedCity: 区コード・非政令市・未知・5桁外は null', () => {
  const designated = deriveDesignated(HYOGO)
  assert.equal(resolveExpandedCity('28111', HYOGO, designated), null) // 西区（区は政令市本体ではない）
  assert.equal(resolveExpandedCity('28201', HYOGO, designated), null) // 姫路市（区を持たない）
  assert.equal(resolveExpandedCity('99999', HYOGO, designated), null) // 未知
  assert.equal(resolveExpandedCity('999', HYOGO, designated), null) // 5桁外
  assert.equal(resolveExpandedCity(null, HYOGO, designated), null)
})

test('resolveSelectedArea: 単独市・行政区・特別区を city_code で解決', () => {
  assert.equal(resolveSelectedArea('23202', AICHI)?.name, '岡崎市')
  assert.equal(resolveSelectedArea('28111', HYOGO)?.name, '神戸市西区')
  assert.equal(resolveSelectedArea('13101', TOKYO)?.name, '千代田区') // 特別区（単独行）
})

test('resolveSelectedArea: 未知・5桁外は null（詳細パネルは落ちない）', () => {
  assert.equal(resolveSelectedArea('99999', HYOGO), null)
  assert.equal(resolveSelectedArea('999', HYOGO), null)
  assert.equal(resolveSelectedArea(null, HYOGO), null)
})

// =====================================================================
// 地図タイル提供元の定数（唯一の真実源）。
//   ライブ地図（src/app/customers/map/page.tsx の L.tileLayer）と
//   PDF 出力（heatmap-pdf/render.ts）が同じ URL テンプレート・帰属・サブドメインを
//   参照してドリフトを防ぐ。
//   ⛔ 値を変えない（提供元・テンプレート・attribution を変えると S-2 に抵触）。
//     ここは値の一致点であって、変更点ではない。
// =====================================================================

// URL テンプレート。page.tsx の L.tileLayer 第1引数と完全一致。
export const OSM_TILE_URL_TEMPLATE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

// 帰属表記。page.tsx の L.tileLayer options.attribution と完全一致。
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors'

// {s} サブドメイン（Leaflet 既定 'abc'）。
export const OSM_SUBDOMAINS = ['a', 'b', 'c'] as const

// ライブ地図の tileLayer maxZoom と一致（PDF 側のズーム上限判定に使う）。
export const OSM_MAX_ZOOM = 19

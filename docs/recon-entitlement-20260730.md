# エンタイトルメント現状 偵察レポート（2026-07-30）

> 目的: 次スプリント「エンタイトルメント v3」の前提整備。
> 本ドキュメントはコード読解と **読み取り専用 SELECT** のみで作成。アプリコードは変更していない。
> 基準コミット: `0bc4c1b`（origin/main。PR #15 まで反映済み）
> 実 DB: Supabase ref `bstohiamtnlgcjulgedy`（ap-southeast-1）。RLS/行数はライブ DB を SELECT で実地確認済み。

参照の凡例: `path:line`。プランの許可判定は `src/lib/plans.ts` に集約（`canUse` / `getEntitlement` / `PLAN_ENTITLEMENTS`）。

---

## 1. 市区町村リストの取得経路

**都道府県一覧** — [src/hooks/useCensus.ts:14-31](../src/hooks/useCensus.ts)
`supabase.from('prefectures').select('*').order('code')` をクライアントから直叩き（RLS のみ）。`onAuthStateChange` で再フェッチ（同 33-46）。

**市区町村＋人口統計一覧** — [src/hooks/useCensus.ts:63-132](../src/hooks/useCensus.ts)
`useMunicipalities(prefectureCode)` がクライアントから直接:
```
supabase.from('municipalities')
  .select('id, prefecture_code, city_code, name, lat, lng, station_passengers_total,
           population_stats(year, population, households, population_delta, population_delta_rate)')
  .eq('prefecture_code', code)
```
- RPC も Route Handler も経由しない。**Supabase JS クライアント → PostgREST 直**（RLS のみが境界）。
- `population_stats` はネスト結合で取得（`useCensus.ts:74`）。
- 取得後 `popLatest`（2025）降順にクライアント側ソート（`useCensus.ts:108`）。
- **当該都道府県の全行がブラウザに渡る**（Free 制限は後段のフロント処理）。

**政令指定都市クリック時の「区一覧」の取得経路**
専用クエリは **存在しない**。区一覧は上記の同一 `municipalities` レスポンスから**クライアント側で名称パースにより導出**する:
- `parseWard(name)` — [src/lib/census.ts:185-189](../src/lib/census.ts)（正規表現 `/^(.+?市)(.+区)$/`）。「名古屋市西区」→ `{city:'名古屋市', ward:'西区'}`。特別区「千代田区」は `市` 接頭辞が無く `null`。
- ダッシュボードで `designatedNames`（区を持つ政令市の集合）と `displayed`（`expandedCity` の区一覧）を導出 — [src/app/dashboard/page.tsx:82-102](../src/app/dashboard/page.tsx)。
- 行クリックで `expandedCity` を立ててドリルダウン — [src/app/dashboard/page.tsx:177-184](../src/app/dashboard/page.tsx)。
- つまり区は独立テーブルでなく `municipalities` の行として存在し（実地確認は §5）、階層は名称文字列から復元している。

---

## 2. Free 上位3件マスクの実装箇所

**定数** `FREE_VISIBLE_AREA_LIMIT = 3` — [src/lib/plans.ts:95](../src/lib/plans.ts)（Free の `visibleAreaLimit`＝3、有料は `null`＝無制限。`plans.ts:117-175`）。

**フック** `usePlanLimit(plan)` — [src/hooks/usePlanLimit.ts:41-51](../src/hooks/usePlanLimit.ts)。`PLAN_ENTITLEMENTS[plan]` から純導出（subscriptions は再フェッチしない）。

**マスク純関数**
- `applyAreaVisibilityLimit(areas, limit)` — [src/hooks/usePlanLimit.ts:61-69](../src/hooks/usePlanLimit.ts)。地図マーカー用に上位 N 件のみ可視化。
- `maskLockedAreaValues(areas, limit)` — [src/hooks/usePlanLimit.ts:79-99](../src/hooks/usePlanLimit.ts)。リスト用に 4 件目以降の実数値（`popLatest`/`popPrev`/`popPrev2`/`householdsLatest`/`delta`/`deltaRate`/`stationPassengersTotal`）を null/0 化し `locked:true` を付与。**`id` と `name` は保持**（key・順位・検索がクラッシュするため）。

**適用箇所（ダッシュボード）** — [src/app/dashboard/page.tsx](../src/app/dashboard/page.tsx)
- `lockedFromIndex` の算出（Free かつ非ドリルダウン時のみ 3）: `page.tsx:107-108`
- 地図: `applyAreaVisibilityLimit(displayed, lockedFromIndex)` → `mapMunicipalities`: `page.tsx:111-114`
- リスト: `maskLockedAreaValues(displayed, lockedFromIndex)` → `listMunicipalities`: `page.tsx:119-122`

**現況（レスポンスに全件が載る）— 確認済み**
- マスクは **クライアント側 slice/コピー**であり、サーバー側フィルタは無い。`municipalities`＋`population_stats` の**全行が既にブラウザへ到達**している。
- コード内でも明記: `usePlanLimit.ts:3-5`（`TODO(Phase2)` RLS のみ・フロント slice）、`usePlanLimit.ts:53-60` および `71-78`（「データ持ち逃げ自体は防げない」「テーブル直クエリは別途 RPC/RLS で塞ぐ必要」）。
- → **v3 の要対応点**: 実値マスクをサーバー（RPC もしくはプラン別 RLS）へ移す。

---

## 3. AreaDetailPanel（＝`MunicipalityDetailPanel`）の構成

コンポーネント: [src/components/ui/MunicipalityDetailPanel.tsx](../src/components/ui/MunicipalityDetailPanel.tsx)（`dashboard/page.tsx:426` で `selected` を渡す）。
セクションは `PanelBody`（`MunicipalityDetailPanel.tsx:35-116`）に上から順に描画:

| # | セクション | 実装 | データ取得 | 既存プランゲート |
|---|---|---|---|---|
| 1 | 人口 基本情報（最新人口・増減率・2020/2015・世帯数） | `MunicipalityDetailPanel.tsx:54-88` | props `m`（`useMunicipalities` で取得済） | **なし**（全プラン表示） |
| 2 | 人口推移グラフ（2015〜2025） | `PopulationSection` `MunicipalityDetailPanel.tsx:91,132-189` | `usePopulationHistory(m.id)` → `municipalities.population_history`(jsonb) | **なし** |
| 3 | マンション取引履歴 | `TransactionSection` `MunicipalityDetailPanel.tsx:94` / [TransactionSection.tsx:18-124](../src/components/ui/TransactionSection.tsx) | `useTransactions(m.id)` → `real_estate_transactions` 直 | **なし** |
| 4 | 駅乗降客数（集約値 XKT015） | `StationSection` `MunicipalityDetailPanel.tsx:97,193-226` | props `m.stationPassengersTotal`（`municipalities` 列） | **なし** |
| 5 | 駅単位ドリルダウン | `StationDrilldownSection` `MunicipalityDetailPanel.tsx:100` / [StationDrilldownSection.tsx:36-77](../src/components/ui/StationDrilldownSection.tsx) | `GET /api/stations?municipality_id=` | **あり**: `usePlanLimit(plan).stationLevelEnabled`（`stationLevelEntitled`＝standard+ **AND** `NEXT_PUBLIC_FEATURE_STATION_LEVEL`）。未達は `return null`（`StationDrilldownSection.tsx:39,77`） |
| 6 | 相場系（公示価格＋取引価格中央値） | `MarketMetricsSection` `MunicipalityDetailPanel.tsx:104` / [MarketMetricsSection.tsx:118-149](../src/components/ui/MarketMetricsSection.tsx) | `GET /api/market-metrics?muni_code=`（5桁） | **あり**: `usePlanLimit(plan).marketMetricsEnabled`（`marketMetricsEntitled`＝standard+ **AND** `NEXT_PUBLIC_FEATURE_MARKET_METRICS`）。未達/コード不正は `return null`（`MarketMetricsSection.tsx:120,149`） |
| 7 | 町域別 仕入れ優先度 | `TownPrioritySection` `MunicipalityDetailPanel.tsx:108` / [TownPrioritySection.tsx:57-99](../src/components/ui/TownPrioritySection.tsx) | `GET /api/towns?muni_code=`（`toMuniCode6` で6桁化） | **あり**: `canUse(plan,'townAcquisitionPriority')`＝platinum。未達は `return null`（`TownPrioritySection.tsx:65,99`） |

要点:
- **並び順**: 人口基本 → 人口推移 → マンション取引 → 駅集約 → 駅ドリルダウン(Standard+) → 相場(Standard+) → 町域優先(Platinum)。
- **セクション 1〜4 は無ゲート**（Free 含む全プランで表示）。有料機能は 5〜7 の3セクションのみで、いずれも自己ゲートで「非表示（描画ゼロ）」。
- 駅/相場は「権限 AND マスターフラグ」の二段。フラグ評価は `usePlanLimit` に一本化（コンポーネントで `plan` 直書きしない方針）。

---

## 4. 既存ゲートの正確な一覧

### 4-1. API 層（`guardFeature` 適用 Route Handler）
`guardFeature` 実装: [src/lib/subscription.ts:57-76](../src/lib/subscription.ts)（未認証 401 / 権限不足 403）。プラン取得は `getUserPlan`（service_role で `subscriptions` 参照。`subscription.ts:21-39`）。

| API | ガード | 行 | 使用 Supabase クライアント |
|---|---|---|---|
| `/api/stations` | `guardFeature('stationLevelEntitled')` | [stations/route.ts:25](../src/app/api/stations/route.ts) | server（anon/authenticated・RLS 有効） |
| `/api/market-metrics` | `guardFeature('marketMetricsEntitled')` | [market-metrics/route.ts:29](../src/app/api/market-metrics/route.ts) | server |
| `/api/towns` | `guardFeature('townAcquisitionPriority')` | [towns/route.ts:43](../src/app/api/towns/route.ts) | server |
| `/api/towns/highlights` | `guardFeature('townAcquisitionPriority')` | [towns/highlights/route.ts:50](../src/app/api/towns/highlights/route.ts) | server |
| `/api/trade-area` | `guardFeature('tradeAreaReport')` | [trade-area/route.ts:112](../src/app/api/trade-area/route.ts) | server |
| `/api/compare` | `guardFeature('areaCompare')` | [compare/route.ts:129](../src/app/api/compare/route.ts) | server |

（`/api/stripe/*`・`/api/inquiries` は本人性/署名検証で別系統。エンタイトルメント対象外。）

### 4-2. DB 層（RLS ポリシー・**ライブ DB で実地確認**）
プラン判定ヘルパー `public.current_user_plan()` — [supabase/migrations/20260628000000_create_current_user_plan.sql](../supabase/migrations/20260628000000_create_current_user_plan.sql)。`SECURITY DEFINER`・`search_path=public,pg_temp`・`WHERE user_id=auth.uid()`・EXECUTE は authenticated/service_role のみ。`getUserPlan()` と1対1（active/past_due のみ有効、想定外プランは free）。

`pg_policies` 実測（`schemaname='public'`）:

| テーブル | SELECT ポリシー | qual（実測） | 書き込み |
|---|---|---|---|
| `stations` | `stations_read_standard_plus` | `current_user_plan() IN ('standard','platinum')` | service_role のみ（[20260704000000](../supabase/migrations/20260704000000_restrict_stations_rls.sql)） |
| `market_metrics` | `mm_read_standard_plus` | `current_user_plan() IN ('standard','platinum')` | `mm_service_role_all`（[20260703000000](../supabase/migrations/20260703000000_create_market_metrics.sql)） |
| `national_metrics` | `nm_read_standard_plus` | `current_user_plan() IN ('standard','platinum')` | `nm_service_role_all` |
| `town_monthly_metrics` | `platinum reads town metrics` | `current_user_plan() = 'platinum'` | service_role のみ（[20260628000100](../supabase/migrations/20260628000100_create_public_town_monthly_metrics.sql)） |
| `municipalities` | `authenticated read municipalities` | **`true`**（全 authenticated） | service_role のみ |
| `population_stats` | `authenticated read population_stats` | **`true`** | service_role のみ |
| `real_estate_transactions` | `authenticated read real_estate_transactions` | **`true`** | service_role のみ |
| `prefectures` | `authenticated read prefectures` | **`true`** | service_role のみ |
| `cities` | `authenticated read cities` **＋** `cities_read_authenticated` | `true` ／ `auth.role()='authenticated'` | service_role のみ |
| `areas` | `authenticated read areas` **＋** `areas_read_authenticated` | `true` ／ `auth.role()='authenticated'` | service_role のみ |
| `subscriptions` | `subscriptions_select_own` | `auth.uid() = user_id` | `subscriptions_write_service_role` |

（ベース RLS は [20260607000003_enable_rls_existing_tables.sql](../supabase/migrations/20260607000003_enable_rls_existing_tables.sql)。）

**ドリフト所見（v3 前に要整理）**: `cities` と `areas` に **SELECT ポリシーが2本ずつ**存在（`*_read_authenticated` はマイグレ未記載の残存＝旧 `20260606_enable_rls.sql` 由来と推測）。`municipalities`/`population_stats`/`real_estate_transactions` は **プラン非依存（true）**で、Free/Starter も全件取得可能。→ v3 で「census 本体をプラン別に締める」場合の主戦場。

---

## 5. `municipalities` テーブルのカラムと 区／東京23区の表現（ライブ DB 実測）

**カラム一覧**（`information_schema.columns` 実測）:
`id`(uuid, PK) / `prefecture_code`(text) / `city_code`(text) / `name`(text, NOT NULL) / `lat`(double) / `lng`(double) / `is_young_family_inflow`(bool) / `young_family_score`(numeric) / `young_family_calc_at`(timestamptz) / `population_history`(jsonb) / `station_passengers_total`(bigint, NOT NULL)。
DDL 起点は [20260606_rebuild_census_schema.sql:18-32](../supabase/migrations/20260606_rebuild_census_schema.sql)（`station_passengers_total` / `population_history` / `young_family_*` は後続マイグレで追加）。

**6桁コード体系**: `municipalities.city_code` は **全 1,916 行が5桁**（`length(city_code)` 実測＝5 のみ）。全国地方公共団体コード6桁（検査数字付き）は保持せず、必要時に `toMuniCode6()`（[src/lib/muni-code.ts](../src/lib/muni-code.ts)）で導出して町域 API に渡す（`TownPrioritySection.tsx:67`）。

**世帯数（households）カラムの所在**: `municipalities` には **無い**。`households` は `population_stats`（年次）にある（[20260606_rebuild_census_schema.sql:40](../supabase/migrations/20260606_rebuild_census_schema.sql)）。パネル表示の世帯数は `useCensus` のネスト結合で最新年から取り出す（`useCensus.ts:100`）。

**政令市の区・東京23区（行として存在するか）**: **どちらも `municipalities` の行として存在**（実測）:
- 政令市の行政区（「◯◯市△△区」形式、名称連結・各行に独自 city_code）: **175 行**。区一覧は §1 の通り `parseWard` で名称から導出（親市の下に折り畳み）。
- 東京特別区（「千代田区」等・`市` 接頭辞なしの独立行）: **23 行**。`parseWard` は `null` を返すためトップレベルにフラット表示される（政令市のようなドリルダウン親を持たない）。
- 参考: 東京都（`prefecture_code='13'`）は 62 行。
- **専用の区テーブルは無い**。「区」は自治体行そのもの。→ v3 で区単位ゲート/表示を扱う場合のキーは `city_code`＋`parseWard`。

---

## 6. `dashboard/page.tsx` の状態管理と CSV/PDF 生成方式

**`useState` 一覧** — [src/app/dashboard/page.tsx:36-46](../src/app/dashboard/page.tsx)（計7個）:
1. `region`（36）— 地方タブ
2. `selectedPrefCode`（37）— 選択中都道府県コード
3. `selected`（38）— 選択中市区町村（詳細パネル対象）
4. `expandedCity`（40）— 政令市ドリルダウン中の市名（区一覧表示）
5. `portalLoading`（42）— Stripe ポータル遷移中
6. `pdfLoading`（44）— PDF 生成中
7. `highlightsOpen`（46）— 注目町域 TOP20 スライドオーバー開閉（Platinum）

派生は `useMemo`（`regionPrefs`/`cityNames`/`isWard`/`designatedNames`/`topLevel`/`displayed`/`mapMunicipalities`/`listMunicipalities`）。プランは `useSubscription()`＋`usePlanLimit(plan)`（`page.tsx:31,33`）。

**URL クエリ未使用の確認**: `useSearchParams` / `searchParams` / `URLSearchParams` / `window.location.search` は **不使用**（grep 0 件）。`next/navigation` からは `useRouter` のみ import（`page.tsx:5`）で `router.push('/pricing')` 等の遷移用途に限る。→ 選択状態は URL に載らず、リロードで初期化される（v3 で共有 URL 化するなら要新規実装）。

**CSV/PDF がクライアント側生成である確認**:
- CSV: `generateMunicipalityCSV`＋`downloadCSV` — [src/lib/csv.ts:40-46](../src/lib/csv.ts)。`Blob`＋`URL.createObjectURL`＋`<a download>` の**純ブラウザ生成**（サーバー呼び出しなし）。ハンドラ `handleCSVDownload`（`page.tsx:124-135`、`limit.canExportCsv` で自己ゲート）。
- PDF: `downloadAreaScorePDF` — [src/lib/pdf.tsx:1,210-223](../src/lib/pdf.tsx)。`'use client'`＋`@react-pdf/renderer` の `pdf().toBlob()` を**ブラウザで実行**（クリック時に動的 import）。ハンドラ `handlePDFDownload`（`page.tsx:137-155`、`limit.canExportPdf` で自己ゲート）。
- いずれも**入力は既にブラウザにある `topLevel`（＝全件）**。出力ゲートは UI フラグのみで、サーバーは介在しない。

---

## 7. `real_estate_transactions`・`population_stats` を読む箇所の全リスト（RLS 締め時に壊れ得る経路）

`real_estate_transactions`:
- [src/hooks/useTransactions.ts:66-69](../src/hooks/useTransactions.ts) — **クライアント直**（`supabase.from(...).eq('municipality_id',…)`）。RLS のみ（現状 `true`）。マンション取引履歴セクション。**無ゲート**。→ RLS をプラン別に締めると Free/Starter で当セクションが空になる。

`population_stats`:
- [src/hooks/useCensus.ts:74](../src/hooks/useCensus.ts) — **クライアント直**（`municipalities` にネスト結合）。ダッシュボード一覧の主経路。締めると一覧の人口/世帯/増減が全プランで欠落。
- [src/app/api/compare/route.ts:47-56](../src/app/api/compare/route.ts) — **server クライアント**（`createSupabaseServerClient`＝呼び出しユーザーの RLS 文脈）で `municipalities`＋`population_stats` を取得。`guardFeature('areaCompare')`＝platinum の後段。
- [src/app/api/trade-area/route.ts:79-87](../src/app/api/trade-area/route.ts) — 同上（server クライアント）。`guardFeature('tradeAreaReport')`＝platinum の後段。

`population_history`（`municipalities` 列。参考・§3-②の経路）:
- [src/hooks/usePopulationHistory.ts:28-31](../src/hooks/usePopulationHistory.ts) — クライアント直（`municipalities.population_history`）。人口推移グラフ。**無ゲート**。`municipalities` の RLS を締めると波及。

**注意**: compare/trade-area は **anon/authenticated の server クライアント**でこれらを読むため、`population_stats`/`municipalities` を `current_user_plan()` 条件で締めると、**platinum 契約者でも RLS が許可する限りしか読めない**。締める条件に standard/platinum を含めれば platinum は通るが、条件設計を誤ると platinum 専用の compare/trade-area が自機能の依存データで壊れる。RLS 変更時は両ルートの platinum 実地確認が必須。

---

## PR-A/B/C 実施上の注意点（5行以内）

1. **Free マスクはクライアント slice のみ**（`usePlanLimit.ts:79`）。実値マスクは RPC かプラン別 RLS でサーバー側へ移さないと持ち逃げは塞げない。
2. **census 3表（municipalities/population_stats/real_estate_transactions）は現状 RLS=`true`**。締めると §7 の無ゲート経路（一覧・人口推移・取引履歴）が全プランで欠落し得る—UI 側フォールバック整備とセット。
3. **RLS は `current_user_plan()` を単一入口に**（plans.ts と1対1）。ポリシー内にプラン名直書き分岐を増やさない。compare/trade-area は server クライアントで RLS 文脈のため platinum 実地確認必須。
4. **区/23区は `municipalities` の行**（政令市区175・特別区23）。区単位の表示/ゲートは `city_code`＋`parseWard` をキーに。専用テーブルは無い。
5. **cities/areas に重複 SELECT ポリシー**（`*_read_authenticated` 残存）。RLS を触る前にドリフト整理を先行。migration 採番は CC-B に集約（既存連番との衝突回避）。

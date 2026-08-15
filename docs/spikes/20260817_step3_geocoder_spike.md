# M2-1 STEP 3 スパイク：ジオコーダ移植工数の測定と位置参照情報での代替可否

- **種別**：調査・見積スパイク（実装なし・DB接続なし）
- **タイムボックス**：2h（開始 2026-08-16 02:07 JST）
- **ブランチ**：`spike/step3-geocoder`（`origin/main` 起点）
- **担当レーン**：CC-A（`src/` 配下）。ただし後述のとおり移植の主要部は **CC-B（`scripts/` / `supabase/migrations/`）** に落ちる。
- **前提**：SD-26 により校区突合は PostGIS 点in面（`ST_Contains`）で確定 → 「売り／反響」側にジオコーディング（住所→座標）が必須工程化。買い側は SD-25（名称突合）でジオコーダ不要。

---

## 0. 最重要の発見（結論の土台）

**問い①（PoC 移植）と問い②（位置参照情報を直接 ETL）は、独立した二択ではない。**

Phase 6 PoC（`/Users/gomez/okazaki-mansion-db`）のローカルジオコーダは、**そのデータ源が国交省「位置参照情報（街区レベル代表点）」そのもの**である（`src/geocode/local.py` は `data/reference/mlit/isj/block/23000-24.0a.csv` を読む）。したがって：

- **問い① = 問い②のデータ ETL ＋ 住所正規化ロジック＋キー突合ロジックの移植**。
- 問い②が言う「`ST_Contains` と組み合わせる」の `ST_Contains` は、**住所→座標の工程ではなく、その下流（座標→校区ポリゴン）**。PoC のジオコーディングは PostGIS ではなく **正規化済み住所の文字列キー完全一致 SELECT**（`WHERE level='block' AND city_code AND town AND chome AND block`）で座標を得ている。

パイプラインを分解すると内部の選択は2つだけ：

| 工程 | 内容 | 実装選択 |
|---|---|---|
| (a) 住所→代表点座標 | テキスト住所を正規化し、位置参照情報の代表点を引く | **文字列キー突合（PoC 方式）以外に手段なし**。テキスト入力である限り PostGIS では代替できない |
| (b) 代表点→校区 | 点を校区ポリゴンに突合 | `ST_Contains`（SD-26 で確定・STEP2 の `public.school_districts.geom`） |

**帰結：問い②は「ジオコーダ不要の代替案」にはならない。** 反響物件の入力がテキスト住所である限り（N-4＝反響物件所在地からの自動付与に一本化）、(a) の正規化＋突合は必須で、問い②は事実上 **問い①のデータ層に内包される**。推奨は両者の**折衷（マージ）**＝ D 節。

---

## A. 問い①：PoC 移植案の見積と根拠

### A-1. PoC 資産の棚卸し（実測）

| 項目 | 実測値 |
|---|---|
| 所在 | `/Users/gomez/okazaki-mansion-db`（※プロンプトのパス欄は空欄。grep で特定。E-1 参照） |
| ランタイム | Python 3.14.5（`requires 3.11+`）。依存＝`beautifulsoup4` / `pytest` / `PyYAML` / `requests`。**正規化・ジオコード本体は Python 標準ライブラリのみ**（`csv` / `re` / `unicodedata` / `sqlite3`）。外部 OSS 依存なし |
| 正規化 | `src/normalize/address.py`：全角半角・漢数字丁目・`丁目/番地/号`・ハイフン表記ゆれを正規化。`NormalizedAddress(town, chome, ban, go, city_code, normalization_key)` を返す |
| ジオコーダ | `src/geocode/local.py`：位置参照情報 CSV（CP932/UTF-8 両対応）→ SQLite `reference_points` に索引化。`geocode()` は **街区/地番点を優先、無ければ大字・町丁目代表点にフォールバック**、無ければ `None`。座標精度は `街区レベル` / `大字町丁目レベル` を返す |
| 保管 | SQLite（`reference.sqlite` 実測 22MB） |
| データ資産 | 位置参照情報・愛知県 街区 CSV `23000-24.0a.csv`＝**1,992,177 行（愛知県全体・212MB）**。町丁目 CSV `23000-19.0b.csv`＝14,639 行。**「岡崎 83,898 点」は愛知県ファイルの岡崎市・代表フラグ=1 の部分集合**（下表で実測再現）|
| ライセンス根拠 | `sources.md` に明記。位置参照情報は**利用約款で利用目的を制限せず商用可**（約款 https://nlftp.mlit.go.jp/isj/agreement.html を実確認）。出典表示義務あり |

**テスト（`pytest --collect-only` 実測）**：

| ファイル | 収集ケース | 移植対象か |
|---|---|---|
| `tests/test_address_normalize.py` | **38**（関数5・パラメトライズ） | ✅ 対象（表記ゆれ／漢数字丁目／曖昧2要素の拒否／非文字列拒否 等の境界ケース）|
| `tests/test_local_geocode.py` | **12** | ✅ 対象（街区優先／地番フルキー／町丁目フォールバック／代表フラグ除外／冪等ロード／CP932 等）|
| `tests/test_fetcher.py` | 5 | ❌ 対象外（適法クローラ＝Phase5 のスクレイピング）|
| `tests/test_schema.py` | 3 | ❌ 対象外（マンション DB の SQLite スキーマ）|
| **合計** | **58** | **移植対象＝50ケース／17関数** |

> ⚠️ ロードマップ v3 の「住所正規化（41テスト）」は本ファイルの正規化テスト（現在38ケース）を指す。「適法クローラー（58テスト）」は現リポジトリの**全体収集数58**と紛らわしいが、フェッチャー実体は5ケース。**移植で担保すべきは正規化38＋ジオコード12＝50ケース**。

### A-2. 8市の街区点・実測行数（愛知ファイルから実測／鹿児島は推定）

対象8市の最低ラインのうち、**愛知7市は既にダウンロード済みの単一ファイル `23000-24.0a.csv` に全て含まれる**（実測）。鹿児島市（46201）のみ鹿児島県ファイル 1本の追加取得が必要。

| 市 | city_code | 生行数 | 代表フラグ=1 |
|---|---|---:|---:|
| 豊橋市 | 23201 | 77,842 | 73,344 |
| 岡崎市 | 23202 | 93,107 | **83,898**（PoC の 83,898 点と一致）|
| 刈谷市 | 23210 | 33,930 | 31,543 |
| 豊田市 | 23211 | 91,814 | 85,051 |
| 安城市 | 23212 | 40,286 | 37,185 |
| 知立市 | 23225 | 13,142 | 11,282 |
| 高浜市 | 23227 | 1,515 | 1,009 |
| **愛知7市計** | | **351,636** | **323,312**（実測）|
| 鹿児島市 | 46201 | — | **約 120,000【推定】**（人口比 岡崎382k→鹿児島593k・約1.5倍からの外挿）|
| **8市 街区点 合計** | | | **約 443,000【推定】** |

町丁目レベル点は 8市合計で **約 5,000【推定】**（愛知県全体で 14,639 行のため）。

### A-3. Supabase 側テーブル案（設計スケッチ）

```
public.geo_reference_points        -- CC-B の migration で作成
  level         text  CHECK (level in ('block','town'))
  muni_code_5   text  -- 5桁 city_code（23202 等）。municipalities.city_code と整合
  town          text  -- 正規化済み町字
  chome         text  DEFAULT ''
  block         text  DEFAULT ''
  lat           double precision
  lon           double precision
  geom          geometry(Point, 4326) GENERATED  -- ST_SetSRID(ST_MakePoint(lon,lat),4326)
  source_url    text
  source_year   text  -- 例: 令和7年度 / 24.0a
  fetched_at    timestamptz
  PRIMARY KEY (level, muni_code_5, town, chome, block)
```

- インデックス：突合が文字列キー主体のため **btree(`level, muni_code_5, town, chome, block`)** が主。校区 `ST_Contains` は代表点（少数）を投げるため点側の GiST は必須ではないが、将来の空間クエリ用に **GiST(`geom`)** を張っておく。
- 分割：`muni_code_5` で運用上分割可能だが、44万行規模なら単一テーブル＋インデックスで十分。
- RLS：`public` 配下のため RLS 有効化。読み取りは authenticated/anon 許可で問題ない（住所→座標の公開参照データ）。**guardFeature/RLS を緩める変更ではない**（機能ゲートは校区集計 API 側で従来どおり）。

### A-4. 呼び出し形：Postgres 関数化 vs アプリ層

CL-07（正規化・突合は Postgres 関数）との整合を最優先。ただし PoC の正規化は **漢数字・全角・丁目/番地/号の正規表現ロジック**で、PLpgSQL への逐語移植は割に合わない。推奨は役割分割：

- **正規化（address.py 相当）**：反響データ取込時の**バッチ**で実行（`scripts/etl/` の Python 共有モジュール）。市区町村一般化して移植。CL/5-A と STEP3/5-C の共有部品（ロードマップ line 113）。
- **突合（(a) の SELECT）＋ 校区付与（(b) ST_Contains）**：**Postgres 関数**（`SET search_path = public, extensions, pg_temp`）。CL-07 整合、`ST_Contains` の解決に必須（前提・STEP2 4-2 で確認済み）。

### A-5. 見積（h）

| 区分 | 内容 | 見積 | 主リスク |
|---|---|---:|---|
| データ ETL | 位置参照情報 CSV→`geo_reference_points`。CP932 パース・8市フィルタ・冪等ロード（`_iter_reference_points` はほぼ逐語移植）。migration＋1自治体試走→8市→検証 | **3–4h** | CC-B レーン。採番は CC-B に集約 |
| 正規化ロジック移植 | **最大の不確実性**。address.py は**岡崎市ハードコード**（`MUNICIPALITY="岡崎市"` / `startswith(MUNICIPALITY)`）。8市×2県への一般化＝(i) 市区町村辞書（pref+muni→5桁/6桁）(ii) 任意住所からの市区町村接頭辞の最長一致除去 (iii) **都道府県アンカー（府中市問題）** の実装。漢数字・丁目/番地/号の数値正規化は city 非依存で**そのまま移植可** | **3–5h** | 一般化の難所。PoC は固定文字列で回避していた |
| テスト移植 | 正規化38＋ジオコード12＝50ケースを一般化後モジュールへ再ターゲット。8市フィクスチャ＋府中市問題回帰＋都道府県アンカー＋境界ケース追加 | **2–3h** | — |
| 検証（E2E） | 代表点→`ST_Contains(school_districts.geom, point)` 疎通、`search_path` 実挙動、反響サンプルで校区付与確認 | **2–3h** | **校区ポリゴン未投入**（後述 B-4/E）|
| **合計** | | **10–15h** | PM の STEP3 概算 13h（ロードマップ line 65）と整合 |

---

## B. 問い②：位置参照情報 直接 ETL 案の評価と見積

### B-1. データ有無・レベル・年度（Web 実確認）

- 位置参照情報は **街区レベル（都市計画区域相当）** と **大字・町丁目レベル（全国）** の2系統。**8市すべて取得可能**。愛知＝令和7年度 `23000-24.0a`（街区）/`23000-19.0b`（町丁目）。鹿児島＝同サービスで**県単位 `46000-…` または市区町村単位 `46201` を単発 DL 可**（ダウンロードは県単位・市区町村単位の両対応）。
- 商用可否：**約款で利用目的の制限なし・商用可**（実確認）。出典表示義務（「街区レベル位置参照情報　国土交通省」＋整備年・ファイル名・加工者）。

### B-2. 精度の質的評価（校区判定に街区代表点で足りるか）

- **内部は十分**：校区ポリゴンの内部にある住所は、街区代表点でも `ST_Contains` が正しい校区に落ちる。
- **境界際が唯一のリスク**：校区境界から数十mの街区は、代表点が隣校区側に落ちて誤判定し得る。**大字・町丁目代表点フォールバックはさらに粗く**、境界リスクが上がる（街区で引けた時のみ街区、無ければ町丁目）。
- **吸収策**：`ST_DWithin(境界, 点, δ)` で境界近傍を検出し「**要確認**」フラグ（＝確定せず推定扱い）。原則1（確定と推定を混ぜない）・原則5（推測で断定しない）に整合。最近傍校区への機械割当は**しない**（誤確定より unknown 保持）。

### B-3. カバレッジの穴

- 街区レベルは **都市計画区域相当のみ**（約款 §2-1・実確認）。市域の郊外・山間部（例：豊田市の広域山間部）に街区点が無い区画が出得る → **大字・町丁目レベル（全国網羅）へフォールバック**。両方とも無い場合は `unknown`。

### B-4. 見積（h）

**問い②を「独立案」として単独実装しても、ETL（3–4h）＋`ST_Contains` 配線（2h）＝5–6h では完結しない。** テキスト住所→座標の (a) 工程が欠落するため。反響が座標付きで入る運用（地図ピン等）なら (a) を省け 5–6h だが、**N-4＝反響物件所在地（テキスト）からの自動付与**が確定仕様のため、この前提は成立しない。よって**問い②単独の実効見積は問い①と同一（10–15h）**で、差分は生じない。

---

## C. リスク比較表

| 観点 | 問い①（PoC 移植） | 問い②（位置参照情報 直接 ETL＋ST_Contains） |
|---|---|---|
| データ源 | 位置参照情報（＝問い②と同一） | 位置参照情報（同一） |
| 住所→座標 (a) | 正規化＋文字列キー突合（実装済み・テスト済み） | **手段を持たない**（テキスト入力では PostGIS で代替不可）→ 実質①へ内包 |
| 座標→校区 (b) | `ST_Contains`（下流・共通） | `ST_Contains`（同一） |
| 精度 | 番地一致で街区／無ければ町丁目代表点 | 同一 |
| 商用ライセンス | OK（約款・商用可・出典義務） | OK（同一） |
| カバレッジ穴 | 街区＝都市計画区域のみ→町丁目フォールバック | 同一 |
| 実効工数 | 10–15h | 10–15h（独立の節約なし） |
| 固有リスク | address.py の**市区町村一般化**（府中市問題） | 「ジオコーダ不要」の誤前提。テキスト入力では成立しない |
| 資産 | **正規化50ケースのテスト資産・CP932 ローダ実績** | 新規（結局①の資産を使う）|

---

## D. 推奨案と M2-5 実施手順案（コミット単位）

**推奨＝折衷（①の正規化・突合ロジック ＋ ②の位置参照情報 ETL を1本のパイプラインに統合）。** 問い②は独立採用せず、①のデータ層として吸収する。

パイプライン：`反響住所(テキスト)` →〔正規化：Python 共有モジュール〕→〔突合：Postgres 関数で `geo_reference_points` から代表点〕→〔`ST_Contains(school_districts.geom, 点)`＝校区／境界近傍は `ST_DWithin` で要確認〕→ 校区集計（n=5 匿名化・STEP4 側）。

### M2-5 コミット単位案

1. **`feat(data): geo_reference_points スキーマ＋GiST/btree`**（CC-B・migration。採番は CC-B 集約）
2. **`feat(data): 位置参照情報 ETL（CP932 パース・8市フィルタ・冪等ロード）`**（CC-B・`scripts/etl/load_geo_reference.py`。`_iter_reference_points` 移植。1自治体試走→8市）
3. **`feat(lib): 住所正規化の市区町村一般化移植（都道府県アンカー／府中市問題）`**（address.py→共有モジュール。正規化38ケース移植＋8市・アンカー回帰追加）
4. **`feat(db): 校区突合 Postgres 関数（search_path=public,extensions,pg_temp）`**（(a)キー突合＋(b)`ST_Contains`／`ST_DWithin` 境界フラグ）
5. **`test: ジオコード12ケース＋E2E（反響サンプル→校区）`**
6. **`docs: 出典表示（街区/町丁目レベル位置参照情報 国土交通省・年度・ファイル名・加工者）`**

**依存の前提**：4/5 は `public.school_districts` に**校区ポリゴン（KSJ A27/A32）が投入済み**であること。STEP2 ドキュメント時点（2026-08-14）で **KSJ 未取得・ポリゴン未投入**のため、STEP3 検証前に投入が必要（E 参照）。

---

## E. 未確認事項と PM が実行すべき SQL

### E-1. 未確認・要判断
1. **プロンプトの PoC パス欄が空欄**だった。grep で `/Users/gomez/okazaki-mansion-db` を特定し、これを PoC と判断して進めた（岡崎83,898点・41→38テスト・位置参照情報依存が一致）。**このパスで正か PM 確認**。
2. **校区ポリゴン未投入リスク**：STEP2 doc（2026-08-14）で KSJ A27/A32 未取得。STEP3 の (b)/検証はこれが前提。**投入時期を M2-5 前に確定**。
3. **鹿児島県ファイルの実 DL**（人手・PM）：県単位 `46000-…` または市区町村単位 `46201`。街区は都市計画区域のみのため鹿児島市の穴の有無を DL 後に確認。
4. **SRID 整合**：位置参照情報＝世界測地系緯度経度（JGD2000, ~EPSG:4612/4326）。KSJ A27/A32 の SRID と一致するか（不一致なら `ST_Transform` 要否）。
5. 正規化の Postgres 関数化 vs Python バッチの最終判断（CL-07 との折り合い。本書は Python バッチ＋突合のみ関数化を推奨）。

### E-2. PM が Supabase コネクタで実行すべき SQL（本スパイクは DB 非接続。実行しない）

```sql
-- (1) PostGIS バージョンと配置スキーマ
SELECT postgis_full_version();
SELECT extname, extnamespace::regnamespace AS schema
FROM pg_extension WHERE extname LIKE 'postgis%';

-- (2) DB の search_path に extensions が含まれるか
SHOW search_path;
SELECT current_setting('search_path');

-- (3) 校区ポリゴンの実在・行数・is_public 分布（未投入なら 0 行）
SELECT count(*) AS rows,
       count(*) FILTER (WHERE is_public) AS public_rows
FROM public.school_districts;

-- (4) 校区ポリゴンの geom 列 SRID と型（位置参照情報 4326 との一致確認）
SELECT f_table_schema, f_table_name, f_geometry_column, srid, type
FROM geometry_columns
WHERE f_table_name = 'school_districts';

-- (5) ST_Contains 疎通の最小試走（search_path 依存の確認・任意の1校区で）
--     ※ lon/lat はダミー。実データ投入後に既知の校区内座標で。
SELECT sd.muni_code_5, sd.school_type
FROM public.school_districts sd
WHERE ST_Contains(sd.geom, ST_SetSRID(ST_MakePoint(139.0, 35.0), 4326))
LIMIT 1;

-- (6) SECURITY DEFINER 関数から ST_Contains を呼ぶ際の search_path 実挙動確認用
--     （public, pg_temp のみだと解決失敗するはず＝前提の裏取り）
```

---

## 完了報告（本文末尾・要約）

- **経過**：約 9 分で主要調査完了（打ち切りなし・タイムボックス2h 内に十分収束）。
- **推奨案**：折衷（位置参照情報 ETL＋PoC 正規化/突合ロジックを1本化。問い②は独立採用せず①に内包）。
- **見積**：**10–15h**（ETL 3–4／正規化一般化 3–5／テスト 2–3／検証 2–3）。PM 概算 13h と整合。
- **残論点**：PoC パス確認／校区ポリゴン未投入／鹿児島 DL／SRID 整合／正規化の関数化判断（E 節）。
</content>
</invoke>

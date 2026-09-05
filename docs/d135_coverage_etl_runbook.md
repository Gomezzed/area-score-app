# D135 商圏カバレッジ拡張 — PO 実行手順書（代表点＋学校区ポリゴン）

> 対象: PO（ローカルで service_role 実行）。検収は PM が Supabase コネクタで。
> ⛔ 本セッション（CC）は ETL を実行しない。本書はコマンドと期待値の提示のみ。
> 作業ブランチ: `feat/d135-coverage-etl`（push/PR は別途）。

## 0. 何を追加するか

| レイヤ | 対象自治体 | 方式 |
|---|---|---|
| 代表点 `geo_reference_points` | 愛知6市（瀬戸23204/西尾23213/尾張旭23226/岩倉23228/北名古屋23234/長久手23238）＋**名古屋16区（案A・区コード23101〜23116）**＋東郷町23302 | 既存 ISJ 愛知ファイルを流用（**新規DL不要**）。辞書に追加した8対象を拾う |
| 学校区 `school_districts` | 愛知6市のみ（瀬戸/西尾/尾張旭/岩倉/北名古屋/長久手 × 小/中） | 台帳の `is_priority_target` を true へ反転（済・本PR）→ 既存 KSJ 愛知ファイルを流用（**新規DL不要**） |

- 名古屋・日進＝PENDING（条件公開）、豊川＝REJECTED、東郷町＝台帳に行なし → **学校区は対象外**（温存）。
- **migration は無い**（schema 無変更。`muni_code_5` は TEXT・値の CHECK なし）。適用作業は不要。

## 1. 前提

- 稼働ディレクトリ: `/Users/gomez/dev/area-score-app`。
- `.env.local` に `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`（値は貼らない）。
- 既存 migration が適用済み（`geo_reference_points`・`school_districts`・台帳・トリガー）。D135 で新規 migration は無い。
- 依存: `pip install -r scripts/requirements.txt`（geopandas/shapely/supabase/dotenv）。代表点の `--dry-run` は stdlib のみで動く。
- ソースファイル（PO が手動DL済のものを流用。**リポジトリにコミットしない**）:
  - ISJ 愛知: `23000-24.0a.csv`（街区）/ `23000-19.0b.csv`（大字・町丁目）
  - KSJ 愛知: `A27-23_23`（小学校区）/ `A32-23_23`（中学校区）
- ⚠ **バックアップ→1自治体試走→全国** の原則（CLAUDE.md §5）。本書も dry-run → 本投入の順。

## 2. 実行順（概観）

```
[代表点] 2A dry-run → 2B 本投入        （geo_reference_points）
[学校区] 3A 台帳 dry-run → 3B 台帳本投入 → 3C ポリゴン dry-run → 3D ポリゴン本投入
[検収]   4  d135_coverage_verify.sql を投入【前後】で実行し差分確認（PM）
```
代表点と学校区は独立。どちらを先でもよい。各本投入の直前に必ず dry-run の件数を控える。

---

## 2A. 代表点 dry-run（DB非接続・件数確認）

```bash
python3 scripts/etl/load_geo_reference_points.py \
  --block-csv /path/to/23000-24.0a.csv \
  --town-csv  /path/to/23000-19.0b.csv \
  --dry-run
```

**確認ポイント（本投入前に必ず控える）**
- 出力の「自治体 × レベル別 件数」に **D135 の8対象コードが出現**すること:
  - 愛知6市: 23204 / 23213 / 23226 / 23228 / 23234 / 23238
  - 名古屋16区: 23101〜23116（**区コードで出る**こと。23100 に丸まらないこと）
  - 東郷町: 23302（`town` レベルは必ず出る想定。`block` は 0 でも可＝町村は街区点なしがある）
- ⚠ **東郷町の街区表記の裏取り**: 東郷町の `block`/`town` の件数が **> 0** で出れば、辞書の複合キー
  （「東郷町」「愛知郡東郷町」両登録）が ISJ の実表記に一致している証拠。もし 23302 が
  **0 件**なら、`--print-fields` 相当で ISJ の `市区町村名` 実値を確認し、辞書へ実表記を追記して再 dry-run。
- ⚠ **名古屋の物量**: 16区の街区点は既存8市合計（約38.3万点）を**超える可能性**がある。
  dry-run の総計を控え、本投入の所要（数十分規模を想定）と行数を見積もること。

## 2B. 代表点 本投入（冪等 UPSERT・累積・再実行安全）

```bash
python3 scripts/etl/load_geo_reference_points.py \
  --block-csv /path/to/23000-24.0a.csv \
  --town-csv  /path/to/23000-19.0b.csv
```
- `geom` は GENERATED のため送らない（スクリプトが除外済）。
- UPSERT キー: `source_version, level, muni_code_5, town_raw, subarea_raw, block_raw`。
- 既存8市の点は同一キーで上書きされるだけ（件数は変わらない）。**追加分＝D135の8対象**。
- 既存の鹿児島（46201）は別ファイル。D135 では愛知ファイルのみで完結する。

---

## 3A. 学校区 台帳 dry-run

```bash
python3 scripts/etl/load_school_district_licenses.py \
  --csv docs/school_district_licenses_r5.csv --dry-run
```
- 本PRで 6市×2＝12行の `is_priority_target` を false→true 済み。CLEARED・attribution 有。
- 出力の CLEARED 件数・attribution 欠損 0 を確認。

## 3B. 学校区 台帳 本投入（is_priority_target=true を DB へ反映）

```bash
python3 scripts/etl/load_school_district_licenses.py \
  --csv docs/school_district_licenses_r5.csv
```
- これで台帳の priority 対象が 11市 → **17市**（既存11＋愛知6）になる。
- ⚠ ポリゴン投入（3D）は台帳の `is_priority_target=true` を参照するため、**必ず 3B を先に**。

## 3C. 学校区ポリゴン dry-run（台帳 read あり・DB書込なし）

```bash
# 小学校区
python3 scripts/etl/load_school_districts.py \
  --input /path/to/A27-23_23.geojson \
  --source-type KSJ_A27_2023 --school-type elementary --dry-run
# 中学校区
python3 scripts/etl/load_school_districts.py \
  --input /path/to/A32-23_23.geojson \
  --source-type KSJ_A32_2023 --school-type junior_high --dry-run
```
- 「自治体 × school_type 別 投入予定件数」に **愛知6市が出現**し、台帳一致（CLEARED）であること。
- ⚠ FIELD_MAP は R5 前提。版が違う場合は `--print-fields` で実カラムを確認してから。

## 3D. 学校区ポリゴン 本投入（冪等 UPSERT・DELETE しない）

```bash
python3 scripts/etl/load_school_districts.py \
  --input /path/to/A27-23_23.geojson \
  --source-type KSJ_A27_2023 --school-type elementary
python3 scripts/etl/load_school_districts.py \
  --input /path/to/A32-23_23.geojson \
  --source-type KSJ_A32_2023 --school-type junior_high
```
- BEFORE トリガーが台帳からライセンス列を写し、生成列 `is_public` が CLEARED＋attribution 有で **true** に追随。
- 既存11市の行は同一キーで上書きされるだけ。**追加分＝愛知6市**。
- 校名（KSJ の `*_004`）が空の地物はスキップし WARNING で報告する（`school_key`/`muni_code_5`/`muni_name`/`school_type`）。`--dry-run` でも同じ WARNING と「除外内訳: 校名欠損 -> N 件」を出すため本実行前に気づける。実例: 鹿児島 A32 の 46222 奄美市に1件（`school_code` は有るが `school_name` 空）。

---

## 4. 検収（PM・SELECT のみ）

`scripts/sql/d135_coverage_verify.sql` を **投入前**と**投入後**に実行し、件数差分で確認する。要点:
- 代表点: 23101〜23116 が distinct 16・**23100 は 0**（案A＝丸めない）。23302 の town ≥ 1。
- 学校区: 6市が `is_public=true`（B-4 が 0 行）。台帳 priority=17市（B-2）。名古屋(23100)・豊川(23207)は false のまま（B-5）。

## 5. ロールバック

`scripts/sql/d135_coverage_rollback.sql` 参照（PM・バックアップ後）。自治体単位 DELETE ＋ 台帳フラグ復元。
台帳 CSV は git で該当12行を戻し、3B を再実行するのが恒久手当。

## 6. 所要目安

| 手順 | 目安 |
|---|---|
| 2A dry-run | 数分（愛知全域パース） |
| 2B 本投入 | **数十分**（名古屋16区の街区点が大量になりうる。dry-run 総計で見積もる） |
| 3A/3B 台帳 | 各 1〜2分（3242行 UPSERT） |
| 3C dry-run | 各数分（GeoJSON 読込＋dissolve） |
| 3D 本投入 | 各数分（6市分の追加・既存は上書き） |

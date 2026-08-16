# geo_reference_points ローダー（位置参照情報の代表点）

M2-5a / SD-31・SD-32(案A)。国土交通省「位置参照情報」の代表点を
`public.geo_reference_points` に冪等投入する。住所→座標のジオコーディング元。

- migration: `supabase/migrations/20260816000000_step3_create_geo_reference_points.sql`（DDL・**適用は PM**）
- ローダー: `scripts/etl/load_geo_reference_points.py`
- 対象: 公開8市のみ（豊橋23201 / 岡崎23202 / 刈谷23210 / 豊田23211 / 安城23212 / 知立23225 / 高浜23227 / 鹿児島46201）
- 街区(block)は**代表フラグ=1 の点のみ**、大字・町丁目(town)は全行。
- **案A＝忠実格納**：ISJ 生フィールド（`town_raw`/`subarea_raw`/`block_raw`）をそのまま格納し、
  住所正規化・キー分割はしない（正規化器の一般化は M2-5b）。

## 依存

`scripts/requirements.txt` に含む（追加なし）。`--dry-run` は **stdlib のみ**で動作し DB に接続しない。
本投入時のみ `python-dotenv` / `supabase` を使う。

```bash
pip install -r scripts/requirements.txt   # 本投入する場合のみ
```

## データファイルの取得（手動DL・コミット禁止）

国土交通省「位置参照情報ダウンロードサービス」から**都道府県単位**で取得する。
本セッションで取得元URL・日時を記録済み（下記）。ZIP/CSV はリポジトリにコミットしない。

| 県 | 種別 | 版 | 取得元URL |
|---|---|---|---|
| 愛知(23) | 街区レベル | 24.0a | https://nlftp.mlit.go.jp/isj/dls/data/24.0a/23000-24.0a.zip |
| 愛知(23) | 大字・町丁目レベル | 19.0b | https://nlftp.mlit.go.jp/isj/dls/data/19.0b/23000-19.0b.zip |
| 鹿児島(46) | 街区レベル | 24.0a | https://nlftp.mlit.go.jp/isj/dls/data/24.0a/46000-24.0a.zip （取得: 2026-08-15T18:49:29Z）|
| 鹿児島(46) | 大字・町丁目レベル | 19.0b | https://nlftp.mlit.go.jp/isj/dls/data/19.0b/46000-19.0b.zip （取得: 2026-08-15T18:49:29Z）|

- 選択画面: https://nlftp.mlit.go.jp/cgi-bin/isj/dls/_choose_method.cgi
- 利用約款: https://nlftp.mlit.go.jp/isj/agreement.html （**利用目的を制限せず商用可・出典表示義務**）
- 展開後の CSV 名は配布時期で異なる（例: `23000-24.0a.csv` または `46_2025.csv`）。中身のヘッダは同一。
  ローダーはヘッダ別名を吸収する。エンコーディングは CP932/UTF-8 を自動判定。

```bash
mkdir -p /tmp/isj/aichi /tmp/isj/kagoshima
unzip ~/Downloads/23000-24.0a.zip -d /tmp/isj/aichi
unzip ~/Downloads/23000-19.0b.zip -d /tmp/isj/aichi
unzip ~/Downloads/46000-24.0a.zip -d /tmp/isj/kagoshima
unzip ~/Downloads/46000-19.0b.zip -d /tmp/isj/kagoshima
```

## dry-run（DB非接続・件数確認）

```bash
# 愛知
python3 scripts/etl/load_geo_reference_points.py \
  --block-csv /tmp/isj/aichi/23000-24.0a.csv \
  --town-csv  /tmp/isj/aichi/23000-19.0b.csv \
  --dry-run

# 鹿児島（展開後 CSV 名は 46_2025.csv 等。source-url は明示推奨）
python3 scripts/etl/load_geo_reference_points.py \
  --block-csv /tmp/isj/kagoshima/46_2025.csv \
  --town-csv  /tmp/isj/kagoshima/46000-19.0b/46_2025.csv \
  --block-source-url https://nlftp.mlit.go.jp/isj/dls/data/24.0a/46000-24.0a.zip \
  --town-source-url  https://nlftp.mlit.go.jp/isj/dls/data/19.0b/46000-19.0b.zip \
  --fetched-at 2026-08-15T18:49:29Z \
  --dry-run
```

### dry-run 実測（2026-08-16・本セッション）

| 市 | block | town |
|---|---:|---:|
| 豊橋 23201 | 73,344 | 380 |
| 岡崎 23202 | 83,898 | 362 |
| 刈谷 23210 | 31,543 | 392 |
| 豊田 23211 | 85,051 | 1,206 |
| 安城 23212 | 37,182 | 137 |
| 知立 23225 | 11,282 | 91 |
| 高浜 23227 | 1,009 | 124 |
| **愛知7市計** | **323,309** | **2,692** |
| 鹿児島 46201 | 57,291 | 361 |
| **8市合計** | **380,600** | **3,053**（総計 **383,653**）|

- 愛知 block はスパイク実測 323,312 と整合（自然キー重複 **3件**＝安城市で last-wins 排除 → 323,309）。
- 鹿児島 block は自然キー重複 73件を last-wins 排除。**重複は代表点として最後の1点を採用**（UNIQUE 制約と同一挙動）。
- 鹿児島は都市計画区域外に街区点が無いため、想定（スパイクの推定約12万）より少ない 57,291。

## 本投入（⛔ PO が service_role で実行。CC は実行しない）

migration 適用後、`.env.local` に `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` がある状態で、
**県ファイルごとに1回ずつ**実行する（冪等 UPSERT なので累積・再実行安全）。

```bash
# 愛知7市
python3 scripts/etl/load_geo_reference_points.py \
  --block-csv /tmp/isj/aichi/23000-24.0a.csv \
  --town-csv  /tmp/isj/aichi/23000-19.0b.csv

# 鹿児島市
python3 scripts/etl/load_geo_reference_points.py \
  --block-csv /tmp/isj/kagoshima/46_2025.csv \
  --town-csv  /tmp/isj/kagoshima/46000-19.0b/46_2025.csv \
  --block-source-url https://nlftp.mlit.go.jp/isj/dls/data/24.0a/46000-24.0a.zip \
  --town-source-url  https://nlftp.mlit.go.jp/isj/dls/data/19.0b/46000-19.0b.zip \
  --fetched-at 2026-08-15T18:49:29Z
```

- `geom` は DB 側 GENERATED（`ST_SetSRID(ST_MakePoint(lon,lat),4326)`）のため payload に含めない。
- UPSERT キー: `source_version, level, muni_code_5, town_raw, subarea_raw, block_raw`。

## テスト

ローダーのロジック確認は `--dry-run` の件数照合で行う（愛知 block=323,309 / 8市 block=380,600）。
純ロジックの単体テストは M2-5b の正規化移植とあわせて追加予定（本セッション範囲外）。

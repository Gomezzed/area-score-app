# e-Stat 小地域データ取得 調査メモ (2026-06-07)

町丁目(小地域)デモグラフィックデータの投入は **保留中**。本メモは調査の確定事項と
未解決点を記録し、後続タスクで再開しやすくするためのもの。

## 背景 / 結論サマリ
- UI(町丁目分析ドロワー)・PDFレポート機能・DBスキーマ(towns/town_*/mansion_master/
  trade_history 等)は**完成済み**。
- データ**投入**だけが未完。原因は e-Stat からの小地域(町丁・字等別)数値データの
  取得 URL が未確定なこと。

## 廃案: e-Stat getStatsList(キーワード検索)方式
`scripts/discover_estat_ids.py`(DEPRECATED)で実証:
- appId は有効、`statsCode=00200521`(国勢調査)単独で 6807 件ヒット。
- しかし `searchWord` に `小地域` / `町丁` / `字等別` / `男女別人口総数及び世帯総数` 等を
  入れると **すべて NUMBER=0**。`statsCode + surveyYears=2020` を列挙しても出るのは
  「人口等基本集計」「時系列データ」等の集計済み表のみで、**町丁・字等別は0件**。
- `build_young_family_inflow.py` のテンプレ `STATS_DATA_IDS` は誤り(getMetaInfo で確認):
  - 2020 `0003447040`/`0003447041` → 実体は「特用林産物生産統計調査(きのこ)」
  - 2015 `0003148556`/`0003148557` → **存在しない**(STATUS=300)
- → 小地域は getStatsList/getStatsData のキーワード検索では取得不可と判断。

## 現行調査: e-Stat 統計GIS(jSTAT MAP)方式
起点: `https://www.e-stat.go.jp/gis/statmap-search?type=2`
駆動 JS: `/modules/custom/gis_download/js/gis_download-main.js`

### 確定した facet ドリルダウン API
`GET https://www.e-stat.go.jp/gis/statmap-search/search_detail`
- JSON で HTML 断片(`detail`/`facet`/`target_facet`/`filter_link` 等)を返す。
- パラメータを積み上げて状態遷移する SPA。サーバ側で遷移を検証(不正な組合せは HTTP 404)。

### 境界(boundary)ブランチ — **動作確認済み**
ドリル順:
`type=2` → `aggregateUnitForBoundary=A`(小地域) → `toukeiCode=00200521`(国勢調査) → `toukeiYear`
で各年の serveyId が判明:

| 年 | 種別 | serveyId | datum |
|----|------|----------|-------|
| 2020 | 小地域(町丁・字等) | `A002005212020` | 2000 / 2011 |
| 2015 | 小地域(町丁・字等) | `A002005212015` | 2000 / 2011 |
| 2010 | 小地域(町丁・字等) | `A002005212010` | 2000 |

境界データの実 DL エンドポイント(動作する形式):
```
GET /gis/statmap-search/data?datatype=2&serveyId=A002005212020&downloadType=1&datum=2000
```
※ `downloadType=1` は**境界(図形)**。人口・世帯の数値ではない。

### ⛔ 未解決: 統計表(statsId)CSV への到達
- 欲しいのは「男女・年齢(5歳階級)別人口」「世帯総数」の**数値 CSV**。
- JS 上の DL 条件: `toukeiYear && aggregateUnit && serveyId && statsId` が揃うと
  `download_disp_flg=1` で `m()`(ダウンロード)が走る。つまり **statsId が必須**。
- しかし:
  - 境界ブランチ(`aggregateUnitForBoundary`)では `serveyId+prefCode=46` まで進めても
    結果リストが空で、`統計表/statsId/男女/世帯` の文字列が応答に一切現れない。
  - 統計ブランチ(`aggregateUnit=A`)は各種組合せで一貫して **HTTP 404**。
  - 都道府県絞り込みは「コチラ」リンク(`js-filter-prefectures-info-text`)経由の
    JS モーダルが別リクエストを発行する作りで、素の GET で未再現。
- → **statsId を surface させる遷移が未解明**。これ以上はパラメータの当て推量に
  なるため、調査を停止。

## 再開時の選択肢
- (A) `js-filter-prefectures-info-text` が発行するリクエストを JS から特定し、
  statsId 一覧 → CSV URL を実証的に確定する。
- (B) e-Stat「統計データダウンロード」画面から、国勢調査 2020/2015・小地域の
  「男女別人口・年齢別」「世帯」表の **statsId(または完成した data? URL)** を
  人手で確認して与える。
- (C) jSTAT MAP の一括 CSV(都道府県別固定 URL)等、別経路を調査。

## 制約メモ(再開時も遵守)
- e-Stat アクセスは 1 秒以上間隔、User-Agent に連絡先を記載。
- 統計表 ID は推測しない。必ず API/サイト応答から取得した値を使う。
- DB upsert はユーザー承認チェックポイント(スキーマ確認 → サンプル3件確認)通過後のみ。

## 関連ファイル
- `scripts/discover_estat_ids.py` … 廃案(getStatsList 方式)。経緯記録として保管。
- `scripts/build_young_family_inflow.py` … 計算/投入本体。`STATS_DATA_IDS` は DEPRECATED。
  小地域データさえ snapshots に入れば、本スクリプトの集計・若返り判定は動作する想定。
- `scripts/matching_mansion_name.py` … マンション名寄せ(別タスク #8.5)。

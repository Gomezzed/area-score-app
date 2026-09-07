# 校区ヒートマップ PDF 出力 v1（PR-A・最小機能）

> 対象：`/customers/map`（`src/app/customers/map/page.tsx`・素 Leaflet）に「PDF出力」ボタンを足し、
> **現在のトグルの校区種別 × 現在の表示範囲**を A4横 PDF 1ページとして端末にダウンロードする。
> クライアント生成のみ。新規 API ルートは作らない。既存の PDF（`src/lib/pdf.tsx`）は変更しない。

## 1. スコープ（この PR で作るもの／作らないもの）
- 作る：現在表示中 × 現在の校区種別を 1 ページ PDF に出力するボタンと生成ロジック（クライアント）。
- 作らない：範囲指定モード／小＋中同時表示／既存 PDF の改修／ゲート変更。

## 2. 権限
- 新規ゲートを作らない・既存ゲートを変えない。
- ボタンは**ヒートマップ API（`school-district-ranking`）の取得が成功した状態でのみ描画**する
  （= `townAcquisitionPriority` に内包）。GeoJSON 側（全プラン）には合わせない。

## 3. 描画方式（案B）
画面の Leaflet には触れない。出力範囲・ズームを自前で計算し、別の `Image` に
`crossOrigin='anonymous'` で OSM タイルを読み込んでオフスクリーン `Canvas` に敷き、
校区ポリゴンも同じ Canvas に**画面と同じ style（`tierToPathStyle`）で**描いて 1 枚の PNG（data URL）にし、
`@react-pdf/renderer` の `<Image>` で埋める。凡例・タイトル・出典・免責・OSM 帰属は react-pdf の `<Text>`。
- ⛔ ライブの `L.tileLayer` に `crossOrigin` を足さない（S-12）。PDF 用は別 `Image` で取得する。
- 前提：OSM タイルは `access-control-allow-origin: *` を返す（S0 #17）。CSP は未設定（S0 #12）。

## 4. 幾何（Q-4・Q-8）
- 用紙：A4横 841.89 × 595.28 pt・余白 10mm。
- ヘッダ帯 12mm（上）／地図フレーム 277 × 150mm（上端 y=24mm）／フッタ帯はフレーム下端から下余白まで。
- 出力倍率 **3 px/pt**（フレーム px ≒ 2356 × 1276・約 216dpi）。
- 「現在表示中」＝画面の中心を固定し、画面の `getBounds()` がフレームに収まる**最大の整数ズーム z** を採用
  （フレーム比に合わせて範囲が画面より広がる。歪ませない）。
- z は画面 `tileLayer` の `maxZoom`（19）以下かつ **18 以下**。
- タイル枚数の上限 **150 枚**（超えたら z を 1 下げる）。
- `{r}` は空文字、`{s}` は Leaflet と同じ `(x+y)%3` で a/b/c。`@2x` 取得はしない。

## 5. タイル取得
- 並列 6・1 枚 8 秒でタイムアウト・失敗タイルは薄い灰色で埋めて継続。
- 完了後に失敗があれば「一部の地図タイルを取得できませんでした」を表示する。

## 6. ポリゴン
- 画面が各 feature の style（`fillColor` / `fillOpacity` / `color` / `weight`）を決めている
  関数・定数（`src/lib/school-district-map-style.ts` の `tierToPathStyle` / `TIER_FILL` / `NO_DATA_FILL`）
  を**そのまま import**し、同じ値で Canvas に描く。
- 抑止校区（tier=null）も画面と同じ色（データ無し・薄いグレー＋破線）で描く。
- tier 以外の値を PDF に載せない。突合キーは `properties.id ↔ RankingRow.school_district_id`。

## 7. 校名ラベル（Q-6 / S-9）
- 画面はポリゴン上に校名ラベルを**描いていない**（`onEachFeature` は click のみ・
  `bindTooltip`/`divIcon`/`marker` 不使用）。よって PDF も**描かない**。

## 8. PDF 記載（Q-5）
- タイトル：「校区別の反響の濃さ ― {muni_name}（小学校区｜中学校区）」（現在の校区種別を表示）。
- 出力日時：JST・分まで。
- 凡例：画面と同じ 5 行・同じ色・同じラベルを定数から import
  （tier4..1 の色＝`TIER_FILL`／ラベル＝`TIER_LABEL`、データ無し＝`NO_DATA_FILL`＋`NO_DATA_LEGEND`）。
- 出典：ranking rows の `attribution_text` をユニーク化して全行印字（年度・機関名をハードコードしない）。
- 免責：画面が使っている免責定数 `SCHOOL_DISTRICT_DISCLAIMER` をそのまま。
- 「地図: © OpenStreetMap contributors」／「areascore.jp」。
- リスト名・組織名・ロゴ・出力者名・メールは載せない。
- PDF メタデータ：title=「校区別の反響の濃さ {muni_name}」・author=「エリアスコア」。

## 9. ファイル名（Q-9）
- `areascore_heatmap_{muni_code_5}_{elementary|junior_high}_{YYYYMMDD-HHmm}.pdf`
- ASCII のみ・UUID を含めない。日時は JST。

## 10. UI（Q-11）
- 地図ヘッダー右（小中トグルの隣）に「PDF出力」ボタン。押すと即生成（本 PR ではパネル無し）。
- 状態：idle / generating（「PDFを生成中…」・ボタン無効）/ done（ファイル名をトースト）/ error（日本語の理由＋再試行）。
- 生成中も地図操作を妨げない。生成後に画面の中心・ズーム・トグルが変わっていないこと（案B なのでライブ地図に触れない）。

## 11. フォント
- 新モジュールで `Font.register({ family:'NotoSansJP', src:'/fonts/NotoSansJP-Regular.woff' })` を
  `src/lib/pdf.tsx:30` と**同じ値**で登録する。`pdf.tsx` は変更しない（S-3・S-13）。

## 12. テスト
- 純関数モジュール（`geometry` / `tiles` / `model`）は外部 import を持たせず、定数は引数で注入する。
- テストは `src/lib/heatmap-pdf/*.test.ts`。相対 import は `.ts` 拡張子明示・`@/` エイリアス不使用（既存作法に合わせる）。

## 13. 観測性
- 失敗時は `Sentry.withScope` でタグ `feature=heatmap-pdf` を付けて `captureException`
  （`src/lib/customer-list/api-envelope.ts:78` と同じ作法・グローバル `setTag` 禁止）。
- PDF 生成モジュールは `page.tsx` からクリック時に**動的 import**（初期バンドルに乗せない）。

## 14. OSM タイル利用ポリシーへの対応（受容リスク・5点）
本機能は OSM の公式タイル（`tile.openstreetmap.org`）をクライアントから直接取得する。
[OSM Tile Usage Policy] を踏まえ、次の 5 点で負荷・帰属要件を満たす前提とする（受容リスク）。
1. **1 回の出力で 150 枚以下**（フレーム＋倍率から算出。超えたら z を 1 下げる）。
2. **z ≤ 18**（高ズームの大量取得を避ける）。
3. **`@2x`（高解像度タイル）を取得しない**。
4. **一括出力をしない**（本 PR はボタン 1 押下＝現在表示中の 1 ページのみ。バッチ生成の導線を持たない）。
5. **帰属表示**（PDF フッタに「地図: © OpenStreetMap contributors」を常時印字）。

> 将来的に出力頻度・枚数が増える場合は、自前タイルプロキシ／商用タイルへの切替を別途検討する（本 PR 範囲外）。

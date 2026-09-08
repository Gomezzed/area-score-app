# 校区ヒートマップ PDF 出力 v1.2（PR-A 最小機能＋PR-B 範囲指定／PR-B2 濃淡フィット）

> 対象：`/customers/map`（`src/app/customers/map/page.tsx`・素 Leaflet）に「PDF出力」ボタンを足し、
> **現在のトグルの校区種別 × 指定した出力範囲**を A4横 PDF 1ページとして端末にダウンロードする。
> クライアント生成のみ。新規 API ルートは作らない。既存の PDF（`src/lib/pdf.tsx`）は変更しない。
>
> **改訂**：v1.0＝PR-A（現在表示中のみ・即時生成）。v1.1＝PR-B（右パネル化・出力範囲3系統・市外を薄くする）。
> v1.2＝PR-B2（出力範囲に「濃淡のある校区に合わせる」を追加し既定へ）。
> §1〜§14 は PR-A の記述を残し、PR-B での差分は §15、PR-B2 での差分は §16 が正とする
> （§10 の「即生成／パネル無し」は §15 が上書き。§15.2 のラジオ並び・既定は §16 が上書き）。

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

---

## 15. v1.1 追記（PR-B・出力範囲指定／市外を薄くする）

### 15.1 スコープ
- 作る：出力範囲の指定（現在表示中／自動調整／ユーザー指定3種）と「市外を薄くする」。UI を右パネル化。
- 作らない：小＋中同時表示（PR-C）／既存 PDF 改修／ゲート変更／`src/lib/pdf.tsx`・タイル提供元・幾何・
  凡例・ファイル名・メタデータ・フォントの変更（PR-A のまま）。ファイル名に範囲モードは入れない。
- 変更しないもの：`src/lib/heatmap-pdf/geometry.ts・tiles.ts・model.ts・document.tsx・tile-source.ts` の
  既存関数のシグネチャ・挙動（関数追加のみ可）。API／RPC／RLS／`guardFeature`／`plans.ts`・`subscription.ts`。

### 15.2 UI（Q-11・§10 を上書き）
- 「PDF出力」ボタンは**即生成をやめ、右サイドパネルを開く**。パネル項目：
  1. 校区種別：現在のトグルの種別を**表示のみ**（変更不可。「小＋中」は PR-C まで置かない＝SD-46）。
  2. 出力範囲（ラジオ）：`現在表示中`（既定）／`{muni_name}全体に自動調整`／`ユーザー指定`。
  3. ユーザー指定のサブ選択（セグメント）：`矩形ドラッグ`／`地図を動かして指定`／`校区をクリック`。
  4. チェック「市外を薄くする」：`自動調整`選択時は既定 ON、他は既定 OFF。ユーザーが切替可。
  5. 「PDFを出力」（状態表示は PR-A と同じ）と「閉じる」。

### 15.3 出力範囲の解決（`useRangeSelect` / `range.ts`）
- 現在表示中：`map.getBounds()`・center=`map.getCenter()`（PR-A と同一経路）。
- 自動調整（Q-2）：読み込み済み GeoJSON の**全 feature**（RLS 通過済み＝その市・現在種別の公開校区）の
  外接矩形を bounds にする。**tier・反響有無で feature を絞らない**（抑止校区の露出防止）。center=bounds 中点。
- 矩形ドラッグ：`map.dragging.disable()`＋カーソル crosshair。mousedown/move/up で `L.rectangle`（破線）を
  プレビュー、mouseup で確定して「やり直す」を表示。ESC・「閉じる」で解除。どの方向でも同じ bounds に正規化。
  幅または高さが **20px 未満は無効**として再操作を促す。center=bounds 中点。
- 地図を動かして指定：パネルを畳み、下部中央に「この範囲で出力」バー。押した時点の `map.getBounds()`。center=中点。
- 校区をクリック（Q-3）：モード中はポリゴン click を「選択/解除」に切替え、既存の詳細パネルは開かない
  （`handlePolygonClick` がモード中ガードで先に消費）。選択中は境界線 `weight+2`（=3）で強調、
  パネルに「N校区を選択中」。bounds＝選択ポリゴンの外接矩形の union。0 件なら出力不可。center=中点。
- bounds をフレームに収める最大整数ズームは PR-A の `tiles.ts`（`chooseZoomWithTileCap`）で計算（現在表示中と同経路）。

### 15.4 生成 API の後方互換
- `exportHeatmapPdf(input)` に `maskOutside?: boolean`（既定 false）を追加。`bounds` は元から必須引数のため
  追加変更なし。未指定＝従来どおり（マスクなし）で既存呼び出しは一切変えない。

### 15.5 市外を薄くする（`mask-path.ts` / `render.ts`）
- `render.ts` はタイル＋ポリゴン描画の**後**に、フレーム全体の矩形と読み込み済み**全 feature の全リング**を
  1 つの `Path2D` にまとめ、`fillStyle='rgba(255,255,255,0.55)'` で `ctx.fill('evenodd')`（合併形の外側だけ白く）。
- リング収集は **tier の有無で feature を絞らない**（抑止校区・tier 無しも含む）。
- 凡例・出典・免責・ラベルは変えない。

### 15.6 状態復帰
- どのモードでも、出力後・キャンセル後に地図の中心・ズーム・トグル・`dragging`・カーソル・ポリゴン style・
  クリック挙動が元に戻る（パネルを開いた時点の中心・ズームを控え、`closePanel` で復帰）。

### 15.7 テスト
- 追加の純関数（`range.ts`：union bounds・矩形正規化・極小判定・feature 群外接矩形・bounds 中点／
  `mask-path.ts`：リング収集・even-odd パス構築＝リング数と点数）は外部 import なし・定数は引数注入。
  相対 import は `.ts` 明示・`@/` 不使用（L39）。

### 15.8 非対応（本 PR 範囲外）
- タッチ操作（iPad 等）は PC のみ対応（Q-10）。矩形ドラッグ等はマウス前提。

## 16. v1.2 追記（PR-B2・濃淡のある校区に合わせる）

### 16.1 スコープ
- 追加：出力範囲に「濃淡のある校区に合わせる」を新設し、**既定**を本モードに変更する。
- 変更しない：幾何・タイル提供元・attribution・凡例・ファイル名・メタデータ・フォント・生成経路。
  `exportHeatmapPdf` の引数は増やさない（`bounds`/`maskOutside` の既存経路で渡す）。API／RPC／RLS／
  `guardFeature`／`plans.ts`・`subscription.ts`・`usePlanLimit.ts`・`src/lib/pdf.tsx` は不触。
- PR-A/PR-B のモジュール（geometry／tiles／model／document／tile-source／mask-path／render）の
  既存関数のシグネチャ・挙動は変えない（`range.ts` に純関数を追加するのみ）。

### 16.2 対象校区（SD-38・PM 裁定＝案1）
- 対象＝**画面で濃淡が付いた校区のみ**＝ランキング取得結果（`get_school_district_heatmap`）に載り
  `tierById` が突合した校区。判定は page.tsx の単一述語 `tierById.has(id)` をそのまま注入し、
  PDF 側で tier 条件を新設しない（単一の真実源）。
- **本モードは k=5 を通過した校区のみを対象とし、抑止校区と反響ゼロは画面上区別できない設計（SD-38）
  のため含めない。** RPC は tier 1..4 のみ返し、抑止校区（k=5）・該当反響なしは同一の破線 NO_DATA
  バケット（`tierById` 非該当）へ融合されるため、フロントでは両者を分離できない。
- v1.1 の対象定義にあった「件数が少ないため表示していません を含む」は誤りとして撤回する。

### 16.3 bounds（4% 余白）
- 対象校区の外接矩形に、上下左右それぞれ span の **4%** を余白として足す
  （`range.ts` の `boundsFromTargetFeatures`＝`boundsFromFeatures`＋`padBounds(_, 0.04)`）。center=bounds 中点。
- 対象が **0 件**なら「現在表示中」へ自動フォールバックし、パネルに
  「濃淡のある校区がないため現在表示中で出力します」を表示する。出力は常に可能。

### 16.4 UI（§15.2 のラジオ並び・既定を上書き）
- 出力範囲（ラジオ）：`濃淡のある校区に合わせる`（**既定**）／`現在表示中`／`{muni_name}全体に自動調整`／
  `ユーザー指定` の順。
- 「市外を薄くする」は本モードでも**既定 ON**（膜の対象は PR-B と同じ＝読み込み済み全 feature の合併形。変えない）。
- ESC・パネル開閉時の既定復帰先も本モード（fit）にする。

### 16.5 匿名化
- 本モードが使う情報は画面が既に描いている（濃淡が付いた）校区の位置だけで、画面以上の情報を出さない。
  件数・順位は使わない。

### 16.6 テスト
- 追加の純関数（`range.ts`：`padBounds`＝span×frac の余白／`boundsFromTargetFeatures`＝述語注入で
  対象抽出＋4% 余白・0 件は null）は外部 import なし・相対 import は `.ts` 明示・`@/` 不使用（L39）。

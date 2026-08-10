# CLAUDE.md ─ エリアスコア SaaS（Phase 4.5 / 7-1完全版リリース）

> **このファイルの役割**：Claude Code / Codex の各セッションが最初に読む固定文脈。
> 新しいセッションを立ち上げたら、まずこのファイルを読ませてからタスクプロンプトを貼る。
> これにより毎回プロジェクト背景を説明し直す必要がなくなる。リポジトリ直下に置く。

## 0. いま何をしているか（スプリント目標）
- **2026/7/1 に完全版をリリース**（β=6/16は終了済み。Phase1〜4は全完了）。
- 残スコープ＝Phase 4.5（T1〜T14）。契約3社が**全社Platinum（月30万円規模）**のため、Platinum機能は実装義務。
- **リポジトリは monorepo**：`Gomezzed/area-score-app`（1つ）。Next.jsアプリは **`src/` 配下**（`src/app/` `src/lib/` 等）、データ層は `scripts/` と `supabase/`。本番はここから稼働中（Production/Preview）。
- **2トラック並列**：CC-A=アプリ層（`src/` 配下＝`src/app/` `src/lib/`）／ CC-B=データ層（`scripts/` `supabase/migrations/`）。ディレクトリ非重複で衝突しない。git worktreeで物理分離して並走。

## 1. プロダクト/技術スタック
- 不動産・マーケ向け地域分析SaaS。Next.js 16(App Router)+Tailwind / Route Handler / FastAPI(データ取得) / Supabase(PostgreSQL+Auth) / Stripe / Vercel。
- 本番：area-score-app（Supabase ref `bstohiamtnlgcjulgedy` / ap-southeast-1 / PG17.6）。URL: area-score-app.vercel.app
- 認証はRoute Handler方式（C案）。Supabaseサーバークライアント経由。

## 2. DBスキーマ地図（実棚卸し済・2026/6/19）
### public（製品本体・RLS有効）
- `subscriptions`：user_id(PK)・plan(`free`/`starter`/`standard`/`platinum` ※**全小文字**・CHECK制約あり)・status(`active`等)。**getUserPlan()の源**。
- `municipalities`(1,916)：ダッシュボードの主。population_history・station_passengers_total等。**`city_code`はe-Stat由来の5桁**（例: `46201`）。
- `prefectures`(47) / `cities`(54) / `areas`(3,265 score/tier GENERATED) / `population_stats`(5,736) / `real_estate_transactions`(2,908)。
- `stations`(9,306)：全国駅・乗降者数・緯度経度。**既投入。新規CREATE不要**。
- `towns`/`town_population_snapshots`/`town_demographics`(全0)：別枠・7/1は不触で温存。
- `mansion_master`/`trade_history`/`building_candidates`(全0)：Phase5。
- `public.town_monthly_metrics`（T3）：**`muni_code`は全国地方公共団体コードの6桁**（例: `352080`）。`public.municipalities`への橋渡しは`municipality_id`(uuid FK)で行う。
- `public.market_metrics`（T4・value_type=confirmed/reference分離）。

> ⚠️ **`town_monthly_metrics.muni_code`（6桁）と `municipalities.city_code`（5桁）は別体系のコードで、桁合わせでの直接比較・JOINはできない。** 両テーブルの結合は必ず `municipality_id`（UUID）経由で行うこと。

### iwakuni（バックヤード・RLS遮断済・service_roleのみ・anon/authenticated到達不可）
- **`town_monthly_metrics`(58,483)＝アプリの正データ**。grain=(muni_code, town_id, as_of)。確定差分＋3スコア＋acquisition＋S/A/B/C/D＋reason。
- `town_monthly`(58,483) / `town_age_monthly`(509,813) / `town`(924 office_name付) / `area_event`(49) / `source_file`(84)。
- `municipality`(2)：6桁コード背骨。`public_municipality_id`でpublic.municipalitiesへ橋渡し（岩国 city_code=35208 / muni_code=352080）。
- **正データ＝iwakuni.town_monthly_metrics。change_metrics は旧世代として除外。**

## 3. プラン×機能マップ（料金v2.1・唯一の定義）
許可は `lib/plans/config.ts` の1箇所だけで定義し、UI(非表示)/API(403)/DB(RLS)の3層が全てそこを参照する。各コンポーネントに `plan === 'platinum'` を直書きしない。

| プラン | 月額 |
|---|---|
| Free | ¥0 |
| Starter | ¥30,000 |
| Standard | ¥50,000 |
| Platinum | ¥100,000 |

| 機能キー | 必要プラン |
|---|---|
| pdfReport | starter 以上 |
| csvExport / stationDrilldown / heatmap | standard 以上 |
| townAcquisitionPriority / areaCompare / tradeAreaReport / alerts / pdfLogo | platinum |

出し分けの現行仕様：
- CSV出力 = standard 以上
- PDFレポート = starter 以上
- Free = 一覧は上位3件のみ表示（残りはロック表示、下位プランへのアップセル導線）

**顧客アタックリスト（`townAcquisitionPriority`）は Platinum に内包する機能**であり、有料オプション化はしない（価格据え置き）。権限判定は必ず `guardFeature('townAcquisitionPriority')` を使う。

## 4. 絶対に守る原則（5つ）
1. **確定(事実)と推定(スコア)を、DB・API・画面のどこでも絶対に混ぜない。** 推定は必ず「推定」バッジ＋reason(計算根拠)。月10万円で売れるかの分岐点。
2. **全国地方公共団体コード6桁を背骨に。** 町名だけをキーにしない（岩国=352080）。
3. **同名異町域があるため一意キーに `office_name`(出張所/支所)を必須に含める。** 増減ビューのPARTITION BYにも含める（原×4・落合×3）。
4. **同一(町域,時点)はUPSERTで上書き可。** 自治体は公表値を後から修正する。
5. 製品側(public)に流すのは確定差分＋ルールベース推定スコアまで。**物件特定・断定はしない**（confirmed/inferred/unknownを分ける）。

## 5. 作業規約（全タスク共通の制約）
- **feature ブランチで作業。main 直マージ禁止。**
- `.env.local` は絶対にコミットしない。秘密情報(キー・トークン)を出力に貼らない。
- **CC-A は `src/`（`src/app/`・`src/lib/` 等）のみ／CC-B は `scripts/` `supabase/migrations/` のみ**を触る。相手の領域に触れない。
- migration採番は既存連番に合わせる（Codex/CC-Bが一本化管理）。worktree間でmigration番号が衝突しないよう、採番はCC-Bに集約する。
- 既存サーバークライアント（`src/lib/supabase/server.ts` 等。正確なパスは初回に `ls src/lib` で確認）があれば import し、新規作成しない。
- DBへの破壊的操作（migration適用・データ投入）は**バックアップ→1自治体試走→全国**の順。一気にやらない。実行はPO。
- 実装前に想定スキーマを `information_schema` で必ず実物確認してからコードを書く（推測でカラム名を決めない）。
- **`guardFeature(...)` は GET ハンドラの冒頭、パラメータ検証より前に置く**（例: `src/app/api/customer-lists/[id]/attack-list/route.ts`）。機能フラグ判定より後・DBアクセスより前が定位置。
- **RLSポリシー内の関数呼び出しは行ごとに再評価される。** `USING`/`WITH CHECK` 句で `(select 関数())` のようにサブクエリで包み、initplan化してパフォーマンス劣化を防ぐ（例: `supabase/migrations/20260808000200_customer_list_perf_and_policy.sql`）。
- ⚠️ **複数のCCセッションを同一フォルダで並行実行しないこと。** 2026/8/8〜9にこれが原因でブランチが交錯し、S3のコミットが誤って `docs/data-audit-202608` に着弾する事故が発生した（PR #26 汚染・cherry-pickで復元）。並列作業は git worktree で物理分離すること（0節参照）。

## 6. 停止条項（危険操作・恒久ルール）
- `git reset --hard` / `git push --force` / `rm` は、承認を得るまで実行禁止。
- DBマイグレーションの適用禁止。適用はPMがSupabaseコネクタで実施する。
- ⛔ Migration 2b は PR #18 の本番デプロイ後まで凍結中。触らない（2026/8/10時点でPR #18は未マージ・OPEN）。
- `.env.local` の値を出力しない（キー名のみ可）。
- `~/Desktop/area-score-app` は別プロジェクト。絶対に触らない。

## 7. 起動コマンド（参考）
`cd /Users/gomez/area-score-app && claude --dangerously-skip-permissions --model claude-opus-4-8`

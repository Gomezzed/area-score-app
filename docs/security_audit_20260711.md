# セキュリティ診断・修正 実施記録（2026-07-11）

> **目的**：本番リリース前の簡易脆弱性診断と修正の記録。
> Stripe「セキュリティ対策申告書」（脆弱性診断の実施が必須）の裏付け資料として保管する。

## 0. 実施概要

| 項目 | 内容 |
|---|---|
| 実施日 | 2026-07-11 |
| 対象 | area-score-app（Next.js 16.2.6 / App Router、Supabase、Stripe、Vercel 本番稼働） |
| リポジトリ | `Gomezzed/area-score-app`（monorepo）|
| 作業ブランチ | `chore/security-audit-20260711`（`feat/platinum-billing` から分岐。main 直接変更なし）|
| 実施環境 | Node.js v26.0.0 / npm 11.12.1 / macOS (darwin 24.5.0) |
| 診断範囲 | ①依存パッケージの既知脆弱性 ②GitHub 自動セキュリティ機能 ③秘密情報の漏洩・セキュリティヘッダー |
| 診断種別 | 簡易診断（SCA = ソフトウェアコンポジション解析 + 構成レビュー）。ペネトレーションテストは含まない。 |

---

## 1. 依存パッケージの脆弱性チェックと修正

### 1.1 実行コマンド

```bash
npm audit                 # 診断
npm audit fix             # 自動修正（破壊的変更なし・--force は不使用）
npm audit                 # 再診断
npm run build             # アプリが壊れていないことを確認
```

### 1.2 修正前の結果（`npm audit`）

**合計 4 件（low 1 / moderate 3 / high 0 / critical 0）**

| # | パッケージ | 深刻度 | 内容 | Advisory | 依存経路 |
|---|---|---|---|---|---|
| 1 | `@babel/core` ≤7.29.0 | low | `sourceMappingURL` コメント経由の任意ファイル読み取り | [GHSA-4x5r-pxfx-6jf8](https://github.com/advisories/GHSA-4x5r-pxfx-6jf8) | `eslint-config-next` → `eslint-plugin-react-hooks`（**開発/Lint時のみ**）|
| 2 | `js-yaml` 4.0.0–4.1.1 | moderate | merge key の別名反復による二次計算量 DoS | [GHSA-h67p-54hq-rp68](https://github.com/advisories/GHSA-h67p-54hq-rp68) | `eslint` → `@eslint/eslintrc`（**開発/Lint時のみ**）|
| 3 | `postcss` <8.5.10 | moderate | CSS Stringify 出力で `</style>` が未エスケープになる XSS | [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) | `next@16.2.6` に同梱（`node_modules/next/node_modules/postcss@8.4.31`）|
| 4 | `next`（#3 経由） | moderate | 脆弱な postcss に依存 | 同上 | 本体（#3 と同一問題）|

### 1.3 修正内容（`npm audit fix`、破壊的変更なし）

`--force` を使わない自動修正を適用。変更されたのは **ビルド/開発時の推移的依存のみ**（実行時のアプリ挙動に影響なし）。主な変更：

| パッケージ | 変更前 | 変更後 |
|---|---|---|
| `@babel/core`（および `@babel/*` 一式）| 7.29.0 | **7.29.7** |
| `js-yaml` | 4.1.1 | **4.3.0** |
| `browserslist` / `caniuse-lite` / `electron-to-chromium` 等 | （旧）| データ更新（無害）|

→ `package-lock.json` のみ更新。`package.json` の宣言バージョンは不変。**#1 と #2 を解消。**

### 1.4 修正後の結果（再 `npm audit`）

**合計 2 件（moderate 2）** — いずれも #3/#4 の postcss（Next.js 同梱分）。

### 1.5 残存脆弱性の判断（#3 postcss / #4 next）

- **なぜ残っているか**：脆弱な `postcss@8.4.31` は **Next.js 16.2.6 が内部でピン留め**している。npm が提示する唯一の自動修正は `npm audit fix --force` だが、その内容は **Next.js を 16.2.6 → 9.3.3 へ 7 メジャー・ダウングレード**するもので、アプリが完全に壊れる。**適用不可**（実施せず）。
  - 調査の結果、**現時点のすべての安定版 Next.js（最新 16.2.10 を含む）が `postcss@8.4.31` を同梱**しており、前方への安全な修正版が存在しない。
  - 修正済み `postcss@8.5.10` は **`next@16.3.0-canary.6` 以降（canary/preview のみ）**に入った。安定版リリースはまだない（Advisory の影響範囲 `≤ 16.3.0-canary.5` とも一致）。
- **実害のリスク：低**。当該脆弱性は「信頼できない CSS を postcss で stringify し、その出力を HTML の `<style>` 文脈に生で描画した場合」に XSS となる。本アプリの postcss は **ビルド時に自作の CSS（Tailwind / CSS Modules）を処理するのみ**で、エンドユーザー入力の CSS を実行時に処理・描画する経路はない。攻撃者が悪用するには CSS ソース自体を改変できる必要があり（＝既にコード改変権限がある状態）、実運用上の攻撃面はほぼ無い。
- **対応方針：上流待ち（監視）**。安全な安定版 Next.js（16.3.x で patched postcss を同梱する版）がリリースされ次第、アップグレードして解消する。Dependabot（下記 §2）で検知・追従する。canary 版の本番採用は行わない。

### 1.6 ビルド確認

`npm run build` を実行し、**正常完了**を確認（TypeScript 型チェック通過、全 25 ページ生成成功）。修正によるアプリ破損なし。

---

## 2. GitHub 自動セキュリティ機能の有効化

### 2.1 作成した設定ファイル（本ブランチに追加）

| ファイル | 役割 | 本ブランチへのコミット |
|---|---|---|
| `.github/dependabot.yml` | Dependabot のバージョン更新設定。npm と github-actions を毎週月曜に確認し更新 PR を作成。| ✅ コミット済み |
| `.github/workflows/codeql.yml` | CodeQL による JS/TS 静的セキュリティスキャン | ⚠️ **本ブランチには未コミット**（下記理由）。代わりに CodeQL は GitHub の **Default setup**（Web）で有効化する方針。設定 YAML 本体は本書 §5 付録に保存。|

> **codeql.yml をコミットしなかった理由**：push に使用した `gh` の OAuth トークンに `workflow` スコープが無く、GitHub が `.github/workflows/` 配下のファイル追加を含む push を拒否したため（2026-07-11）。CodeQL は **Default setup** ならワークフローファイルのコミット不要で有効化できるため、そちらを採用（§2.2 B）。将来 Advanced setup（自前 YAML）に切り替える場合は §5 付録の YAML を、`workflow` スコープ付きトークンで別途コミットする。
>
> `dependabot.yml` は `.github/workflows/` 配下ではないため `workflow` スコープ不要で、通常どおりコミット済み。有効化は既定ブランチ（main）へのマージ後。

### 2.2 GitHub Web 画面で必要な「オン」操作

設定ファイルだけでは有効にならない項目がある。以下を GitHub 上で操作すること（要 admin 権限）。

**A. Dependabot 脆弱性アラート＋セキュリティ更新（`dependabot.yml` とは別物）**
1. リポジトリ → **Settings** → 左メニュー **Advanced Security**（または **Code security and analysis**）
2. **Dependabot alerts** → **Enable**
3. **Dependabot security updates** → **Enable**（脆弱性検知時に修正 PR を自動作成）
4. （任意）**Dependency graph** が有効であることを確認（通常は既定で ON）

**B. CodeQL / Code scanning（Default setup を採用）**
1. 同じ **Settings → Advanced Security（Code security and analysis）** 画面
2. **Code scanning** → **Set up** → **Default** を選択。GitHub が言語（JS/TS）を自動検出し、ワークフローをサーバー側で自動生成・実行する（リポジトリへの `codeql.yml` コミットは不要）。
3. 実行結果は **Security → Code scanning alerts** に表示される。
4. プライベートリポジトリの場合、**GitHub Advanced Security** が必要なことがある（public リポジトリは無料）。プランにより表示が異なるため、上記画面で有効化可否を確認する。
5. （任意）自前ワークフローで細かく制御したい場合は **Advanced** を選び、§5 付録の YAML を `workflow` スコープ付きトークンでコミットする。

**C. Secret scanning + Push protection（推奨・強く推奨）**
1. 同画面の **Secret scanning** → **Enable**
2. **Push protection** → **Enable**（秘密情報の push を事前ブロック。`.env.example` のコメントでも言及済み）

---

## 3. 基本的なセキュリティ設定の確認

### 3.1 秘密情報の漏洩チェック — 結果：**問題なし（良好）**

| 確認項目 | 結果 |
|---|---|
| `.gitignore` で `.env*` を除外（`!.env.example` のみ許可）| ✅ 適切 |
| git 追跡下の `.env` 系ファイル | `.env.example`（プレースホルダのみ）だけ。実値ファイル `.env.local` は**未追跡** ✅ |
| `.env.local` の過去コミット履歴 | **一度もコミットされていない** ✅ |
| ソース/`public/` へのハードコード秘密（`sk_live_`/`whsec_`/service_role キー等）| **検出なし** ✅ |
| `public/` フォルダの中身 | 静的アセット（svg/png/font）のみ。秘密情報なし ✅ |
| `NEXT_PUBLIC_` 接頭辞の妥当性 | 秘密（`SUPABASE_SERVICE_ROLE_KEY` / `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `RESEND_API_KEY`）は **NEXT_PUBLIC_ なし**。公開可能な値（anon key / publishable key / price id / 機能フラグ）のみ `NEXT_PUBLIC_` ✅ |
| サーバー専用秘密の使用箇所 | `src/app/api/**`（stripe/inquiries）と `src/lib/{stripe,supabase-admin}.ts` のみ。**`"use client"` 付きファイルでの使用は皆無**（クライアントへの漏洩なし）✅ |

> 補足（任意のハードニング）：`src/lib/stripe.ts` と `src/lib/supabase-admin.ts` の先頭に `import 'server-only'` を追加すると、誤ってクライアントバンドルへ取り込んだ際にビルドエラーで気付ける（多層防御）。必須ではない。

### 3.2 セキュリティレスポンスヘッダー — 結果：**未設定（要改善）**

- `next.config.ts`：`headers()` 未定義。
- `vercel.json`：`headers` 設定なし。
- `src/proxy.ts`（ミドルウェア）：認証のみで、セキュリティヘッダーの付与なし。かつ matcher が限定的で全ルートを覆わない。

→ 現状、**CSP / HSTS / X-Frame-Options / X-Content-Type-Options / Referrer-Policy / Permissions-Policy がいずれも未付与**。

#### 推奨設定（提案・**未適用**。本番挙動に影響するため適用は PO 判断）

`next.config.ts` に以下を追加する案（全ルートに適用）。CSP は Next.js のインラインスクリプト/スタイル、Supabase・Stripe・地図タイルの読み込みを考慮した初期値。**まず `Content-Security-Policy-Report-Only` で試験導入し、コンソールの違反を潰してから強制へ切り替える**ことを推奨。

```ts
// next.config.ts（提案。適用前に Report-Only で検証すること）
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // 検証が済むまでは Content-Security-Policy-Report-Only を推奨
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://js.stripe.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.supabase.co",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co https://api.stripe.com",
      "frame-src https://js.stripe.com https://checkout.stripe.com",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
```

> 注意点：
> - CSP の `img-src` / `connect-src` は実際に使うホスト（Supabase プロジェクト URL、利用中の地図タイル配信元）に合わせて調整する。react-leaflet のタイル元が OpenStreetMap 以外なら追加が必要。
> - `script-src 'unsafe-inline'` は Next.js の都合で当面必要になりやすい。nonce ベースへの厳格化は将来の課題。
> - Vercel は HTTPS/HSTS を既定で一部担うが、明示設定が申告上も確実。
> - **適用時は必ず Report-Only → 本番挙動確認 → 強制、の順**。いきなり強制すると地図・決済・グラフ描画が壊れるリスクがある。

---

## 4. 結果サマリと残課題

### 4.1 サマリ

| ステップ | 結果 |
|---|---|
| 1. 依存脆弱性 | 4 件検出（low1/mod3）→ 安全な `npm audit fix` で 2 件解消。ビルド正常。残 2 件は Next.js 同梱 postcss（実害低・上流待ち）|
| 2. GitHub 自動化 | `dependabot.yml` / `codeql.yml` を作成。Web 画面での有効化手順を明記 |
| 3a. 秘密情報 | **漏洩なし（良好）**。env 管理・NEXT_PUBLIC_ 運用・サーバー専用秘密の分離すべて適切 |
| 3b. ヘッダー | **未設定**。推奨 CSP 等を提案（未適用、PO 判断待ち）|

### 4.2 残課題（TODO）

- [ ] **postcss（#3/#4）**：安全な安定版 Next.js リリースを待ってアップグレード（Dependabot で追従）。
- [ ] **セキュリティヘッダー**：§3.2 の推奨設定を Report-Only で試験導入 → 検証 → 本番適用（PO 判断）。
- [ ] **GitHub Web 操作**：§2.2 の A/B/C（Dependabot alerts・Code scanning=**Default setup**・Secret scanning + Push protection）を有効化。
- [ ] （任意）CodeQL を Default setup ではなく Advanced setup（自前 YAML）で運用する場合、§5 付録の YAML を `workflow` スコープ付きトークンでコミット。
- [ ] （任意）`src/lib/{stripe,supabase-admin}.ts` に `import 'server-only'` を追加。

### 4.3 本記録の適用範囲・注意

- 本診断は **簡易診断（SCA + 構成レビュー）** であり、動的ペネトレーションテスト・認証/認可の網羅的検証・RLS ポリシーの実地監査は含まない。
- 実行時点のスナップショット（2026-07-11）。依存の脆弱性状況は日々更新されるため、Dependabot / CodeQL による**継続監視**を前提とする。

---

## 5. 付録：CodeQL Advanced setup 用ワークフロー YAML（参考・未コミット）

Default setup（§2.2 B）ではなく自前ワークフローで運用したい場合、以下を `.github/workflows/codeql.yml` として、`workflow` スコープ付きトークンでコミットする。

```yaml
name: "CodeQL"

on:
  push:
    branches: ["main"]
  pull_request:
    branches: ["main"]
  schedule:
    - cron: "0 0 * * 1"   # 毎週月曜 00:00 UTC（= 月曜 09:00 JST）

jobs:
  analyze:
    name: Analyze (${{ matrix.language }})
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      actions: read
      contents: read
      security-events: write
    strategy:
      fail-fast: false
      matrix:
        language: ["javascript-typescript"]
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
      - name: Initialize CodeQL
        uses: github/codeql-action/init@v3
        with:
          languages: ${{ matrix.language }}
          queries: security-extended
      - name: Autobuild
        uses: github/codeql-action/autobuild@v3
      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v3
        with:
          category: "/language:${{ matrix.language }}"
```

---

*記録者：Claude Code（Gomezzed 環境）／ ブランチ `chore/security-audit-20260711`*

# エリアスコア分析ダッシュボード

## セットアップ手順

### 1. Supabaseでテーブルを作成

1. [Supabase](https://supabase.com) でプロジェクトを作成
2. **SQL Editor** を開き、`supabase/schema.sql` の内容を実行
   - `cities` テーブル（都市マスタ）と `areas` テーブル（スコア自動計算）が作成されます
   - 鹿児島・仙台・愛知のサンプルデータが自動挿入されます

3. **Authentication** → **Email** を有効化し、テストユーザーを作成

### 2. 環境変数を設定

`.env.local` を編集してSupabase接続情報を入力:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
```

### 3. 開発サーバー起動

```bash
npm install
npm run dev
```

### 4. Vercelにデプロイ

```bash
# Vercel CLIを使う場合
npm install -g vercel
vercel

# 環境変数をVercelに設定
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
```

## スコアリング計算式

```
スコア = 取引件数 × 40% + 人口増減率 × 30% + 平均価格水準 × 30%
```

| Tier | スコア条件 | 地図色 |
|------|-----------|--------|
| A    | 70点以上   | 緑     |
| B    | 40〜69点  | 黄     |
| C    | 39点以下   | 赤     |

## 新しい都市を追加する方法

Supabase の SQL Editor で以下を実行:

```sql
INSERT INTO cities (name, name_en, center_lat, center_lng, zoom_level)
VALUES ('札幌', 'sapporo', 43.0621, 141.3544, 12);
```

## CSVエクスポート (Salesforce連携)

ダッシュボード右上の「CSV出力」ボタンをクリックすると、現在表示中のエリアデータをSalesforceインポート形式でダウンロードできます。

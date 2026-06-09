ultrathink

# タスク：Stripe β特別価格クーポン運用 + プラン名統一

## 重要な前提
- このプロジェクトは Next.js 16 App Router + Supabase + Stripe + TypeScript
- 既存の subscriptions テーブル / Webhook / Checkout Route は壊さない
- 既存の plan='light' レコードがある（subscriptions テーブル、1件）

## PO 確定事項
- 通常価格：Starter ¥50,000 / Standard ¥100,000 / Platinum ¥300,000
- β特別価格：Starter ¥30,000 / Standard ¥50,000 / Platinum ¥100,000
- β価格は契約継続中ずっと据え置き（duration: 'forever'）
- light → starter にマッピング（PO確認済み）

## Stripe Dashboard 側の事前作業（PO実施済み前提）
以下を確認すること。未実施なら作業を停止して PO に依頼。
- 商品3つ作成済み: エリアスコア Starter / Standard / Platinum
- クーポン3つ作成済み: BETA_STARTER (¥20,000OFF) / BETA_STANDARD (¥50,000OFF) / BETA_PLATINUM (¥200,000OFF) すべて duration: forever
- 環境変数 STRIPE_PRICE_STARTER / STANDARD / PLATINUM、STRIPE_COUPON_BETA_STARTER / STANDARD / PLATINUM が .env.local に設定済み

## 既存実装の調査（最初に必ず実行）
1. src/app/api/stripe/checkout/route.ts
2. src/app/api/stripe/webhook/route.ts
3. src/lib/stripe.ts
4. supabase/migrations/ の subscriptions テーブル定義
5. .env.local の STRIPE_PRICE_LIGHT_PRICE_ID 等の旧変数の有無

## 実装ステップ

### Step 1：Checkout Route Handler 改修
src/app/api/stripe/checkout/route.ts を更新：
- GET メソッドで ?plan={starter|standard|platinum} を受け取る
- 認証チェック（未ログインなら /login へリダイレクト）
- PRICE_MAP で plan → { priceId, couponId } をマッピング
- Stripe Checkout Session 作成時に discounts: [{ coupon: couponId }] を追加
- success_url: /dashboard?checkout=success
- cancel_url: /?checkout=cancel
- metadata に user_id と plan を含める

### Step 2：Webhook の plan 値統一
src/app/api/stripe/webhook/route.ts を更新：
- customer.subscription.created / updated で metadata.plan を取得して subscriptions テーブルに保存
- 既存の 'light' のハードコードを starter/standard/platinum に置換
- metadata.plan が空の場合は priceId から逆引き

### Step 3：既存 subscriptions の plan 値マイグレーション
supabase/migrations/YYYYMMDDHHMMSS_normalize_plan_values.sql を作成：

UPDATE subscriptions
SET plan = 'starter'
WHERE plan = 'light';

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan IN ('starter', 'standard', 'platinum'));

### Step 4：動作確認
- Stripe Dashboard で商品/クーポン作成済み確認
- LP の Starter CTA → ¥30,000 表示
- LP の Standard CTA → ¥50,000 表示
- LP の Platinum CTA → ¥100,000 表示
- テストカード 4242 4242 4242 4242 で決済成功
- Webhook で subscriptions に starter/standard/platinum で記録
- 既存 light レコードが starter に更新
- npm run build エラーなし

## 絶対に壊してはいけない
- 既存の認証フロー
- subscriptions テーブルの既存カラム
- ダッシュボード機能
- Webhook 署名検証

## 完了報告
1. 変更ファイル一覧
2. テスト決済結果
3. npm run build 結果
4. 残課題

実装開始してください。

# Stripe セットアップ手順

このドキュメントは、本アプリの Stripe サブスクリプション課金を有効化するための
設定手順をまとめたものです。

---

## 1. 環境変数（`.env.local`）

| 変数名 | 用途 | 例 |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | サーバー用シークレットキー | `sk_test_...` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | クライアント用公開キー | `pk_test_...` |
| `NEXT_PUBLIC_STRIPE_LIGHT_PRICE_ID` | LIGHT プランの Price ID | `price_...` |
| `NEXT_PUBLIC_STRIPE_STANDARD_PRICE_ID` | STANDARD プランの Price ID | `price_...` |
| `STRIPE_WEBHOOK_SECRET` | Webhook 署名シークレット | `whsec_...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Webhook が RLS をバイパスして DB 更新するためのキー | `eyJ...` |

> `STRIPE_WEBHOOK_SECRET` は後述の Webhook 登録後に取得して設定します。

---

## 2. 商品 / 価格（Price）の作成

Stripe ダッシュボード → **商品 (Products)** で 2 つの定期課金（サブスクリプション）商品を作成します。

| プラン | 金額（税込） | 課金間隔 | 通貨 |
| --- | --- | --- | --- |
| LIGHT | ¥33,000 | 月次 (monthly) | JPY |
| STANDARD | ¥55,000 | 月次 (monthly) | JPY |

> JPY は「ゼロ十進通貨」なので、Stripe 上の金額はそのまま `33000` / `55000` と入力します（×100 不要）。
> 税込で運用する場合は、上記金額をそのまま価格として設定します（Stripe Tax を使う場合は税抜価格 + 税設定でも可）。

作成後、各 Price の **Price ID（`price_...`）** を `.env.local` の
`NEXT_PUBLIC_STRIPE_LIGHT_PRICE_ID` / `NEXT_PUBLIC_STRIPE_STANDARD_PRICE_ID` に設定します。

---

## 3. Webhook の登録

本アプリの Webhook エンドポイントは:

```
POST https://<本番ドメイン>/api/stripe/webhook
```

### 本番（Stripe ダッシュボード）

1. Stripe ダッシュボード → **開発者 (Developers)** → **Webhook** → **エンドポイントを追加**
2. エンドポイント URL に上記を入力
3. 「リッスンするイベント」で以下を選択:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. 作成後に表示される **署名シークレット（`whsec_...`）** を
   `.env.local` の `STRIPE_WEBHOOK_SECRET` に設定する

### ローカル開発（Stripe CLI）

```bash
# 1. Stripe CLI をインストール（macOS）
brew install stripe/stripe-cli/stripe

# 2. ログイン
stripe login

# 3. Webhook をローカルへ転送（dev サーバーを :3000 で起動しておく）
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

`stripe listen` 実行時にターミナルへ表示される `whsec_...` を
`.env.local` の `STRIPE_WEBHOOK_SECRET` に設定し、dev サーバーを再起動します。

イベントを手動で発火してテストする例:

```bash
stripe trigger checkout.session.completed
stripe trigger invoice.payment_failed
```

---

## 4. カスタマーポータルの有効化

プラン変更・解約・支払い方法更新は Stripe **カスタマーポータル**を使用します。

1. Stripe ダッシュボード → **設定** → **Billing** → **カスタマーポータル**
2. ポータルを有効化し、許可する操作（プラン変更・解約など）を設定
3. （任意）変更可能なプランとして LIGHT / STANDARD の Price を登録

ダッシュボード右上の「請求情報を管理」ボタンから遷移します。

---

## 5. テストカード番号

テストモード（`sk_test_` / `pk_test_`）で使用できる代表的なカード番号:

| シナリオ | カード番号 | 補足 |
| --- | --- | --- |
| 決済成功 | `4242 4242 4242 4242` | 最も一般的 |
| 3D セキュア認証が必要 | `4000 0025 0000 3155` | 認証画面が表示される |
| 残高不足で失敗 | `4000 0000 0000 9995` | `invoice.payment_failed` のテストに有用 |
| カード拒否 (generic) | `4000 0000 0000 0002` | |

共通の入力値:

- **有効期限**: 任意の未来の日付（例: `12 / 34`）
- **CVC**: 任意の 3 桁（例: `123`）
- **郵便番号**: 任意（例: `12345`）

---

## 6. 動作確認フロー

1. `.env.local` に全変数を設定（`STRIPE_WEBHOOK_SECRET` 含む）
2. Supabase でマイグレーション `supabase/migrations/20260607000000_create_subscriptions.sql` を実行
3. `npm run dev` を起動
4. 別ターミナルで `stripe listen --forward-to localhost:3000/api/stripe/webhook`
5. ログイン → `/pricing` で LIGHT もしくは STANDARD を選択
6. テストカード `4242 4242 4242 4242` で決済
7. `/dashboard?checkout=success` に戻り、全データが閲覧可能になっていることを確認
8. `subscriptions` テーブルに行が作成され、`plan` / `status` が更新されていることを確認
9. ダッシュボード右上「請求情報を管理」からカスタマーポータルに遷移できることを確認

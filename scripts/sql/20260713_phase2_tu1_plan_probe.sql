-- ============================================================
-- Phase 2 プラン切替 SQL（検証専用）
--
--   実行は PO 承認後に Supabase コネクタ／SQL Editor で行うこと。
--   自動実行・アプリからの実行は禁止。
--
--   対象は TU1（user_id 先頭8桁 = 12164b44）の 1 行のみ。
--   すべての UPDATE/INSERT/DELETE に user_id の WHERE / 値指定を必須とする。
--   5633fbad…（PO本人）/ 702e19c5…（y.azumi）には絶対に触れないこと。
--
--   使い方（1プランずつ）:
--     1) 下記いずれかの「切替」ブロックを1本実行してTU1のplanを設定
--     2) ターミナルで  source ~/.area-score-secrets && node scripts/verify/phase2-rls-probe.mjs
--        を実行し、そのプランの6テーブル照会結果を採取
--     3) 次のプランへ。全プラン終了後に「free復帰＋後片付け」を実行
-- ============================================================

-- ── dry-run: 現在のTU1行を確認（存在しなければ0行＝free扱い） ──
SELECT * FROM public.subscriptions
WHERE user_id = '12164b44-16e1-4c5e-98ea-d7a5963fc17b';

-- ── 切替①: platinum（★陽性対照。town_monthly_metrics が >0 になるはず） ──
INSERT INTO public.subscriptions (user_id, plan, status,
  stripe_customer_id, stripe_subscription_id, current_period_end)
VALUES ('12164b44-16e1-4c5e-98ea-d7a5963fc17b', 'platinum', 'active', NULL, NULL, '2099-12-31T23:59:59+00')
ON CONFLICT (user_id) DO UPDATE
  SET plan = EXCLUDED.plan, status = 'active',
      stripe_customer_id = NULL, stripe_subscription_id = NULL,
      current_period_end = EXCLUDED.current_period_end;

-- ── 切替②: standard（market_metrics / national_metrics / stations が >0、town_monthly_metrics=0） ──
INSERT INTO public.subscriptions (user_id, plan, status,
  stripe_customer_id, stripe_subscription_id, current_period_end)
VALUES ('12164b44-16e1-4c5e-98ea-d7a5963fc17b', 'standard', 'active', NULL, NULL, '2099-12-31T23:59:59+00')
ON CONFLICT (user_id) DO UPDATE
  SET plan = EXCLUDED.plan, status = 'active',
      stripe_customer_id = NULL, stripe_subscription_id = NULL,
      current_period_end = EXCLUDED.current_period_end;

-- ── 切替③: starter（gated 4テーブルすべて 0、municipalities/population_stats のみ全件） ──
INSERT INTO public.subscriptions (user_id, plan, status,
  stripe_customer_id, stripe_subscription_id, current_period_end)
VALUES ('12164b44-16e1-4c5e-98ea-d7a5963fc17b', 'starter', 'active', NULL, NULL, '2099-12-31T23:59:59+00')
ON CONFLICT (user_id) DO UPDATE
  SET plan = EXCLUDED.plan, status = 'active',
      stripe_customer_id = NULL, stripe_subscription_id = NULL,
      current_period_end = EXCLUDED.current_period_end;

-- ── free 復帰＋後片付け: TU1行を削除（行が無ければ current_user_plan()='free'） ──
DELETE FROM public.subscriptions
WHERE user_id = '12164b44-16e1-4c5e-98ea-d7a5963fc17b';

-- ── 検証: 終了時に 2 行（PO本人 platinum / y.azumi starter）に戻ること ──
SELECT count(*) AS remaining_rows FROM public.subscriptions;  -- 期待: 2

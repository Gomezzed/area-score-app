-- =====================================================================
-- scripts/sync_town_monthly_metrics.sql  (T3 運用ランブック / 適用は PO)
--
-- これは「実行手順書」であり、上から順に PO が手動で流す想定。
-- 破壊的操作（同期実行）は CC が実行せず、PO が service_role 文脈
-- （Supabase SQL Editor）で実行する。一気に全国へ流さない。
--
-- 前提: 先に下記 migration を適用済みであること（適用順）
--   1) 20260628000000_create_current_user_plan.sql
--   2) 20260628000100_create_public_town_monthly_metrics.sql
--   3) 20260628000200_sync_iwakuni_town_monthly_metrics.sql
-- ※ 本番の現行 migration head は 20260616235407。上記3本はそれより後で
--   採番済みのため適用順は安全（衝突なし）。
-- =====================================================================


-- ── STEP 0: バックアップ（pg_dump。シェルで実行） ─────────────────────
-- public スキーマのみダンプ（最低限、対象テーブルが無い段階なので全体でも軽い）。
--   pg_dump "$SUPABASE_DB_URL" --schema=public \
--     -f backup_public_$(date +%Y%m%d_%H%M%S).sql
-- ※ 接続文字列・パスワードはコマンド履歴/出力に貼らないこと。


-- ── STEP 1: 岩国(352080) 1自治体 試走 ───────────────────────────────
-- 戻り値（UPSERT 行数）が 23291 になることを確認する。
SELECT public.sync_town_monthly_metrics_from_iwakuni('352080') AS upserted_rows;
-- 期待値: 23291


-- ── STEP 2: 検算（試走の妥当性確認）─────────────────────────────────
-- 2-1. public 取り込み件数が iwakuni 側の取り込み対象件数と一致するか。
SELECT
  (SELECT count(*) FROM public.town_monthly_metrics WHERE muni_code = '352080') AS public_rows,
  (SELECT count(*)
     FROM iwakuni.town_monthly_metrics m
     JOIN iwakuni.town t ON t.muni_code = m.muni_code AND t.town_id = m.town_id
     JOIN iwakuni.municipality mu ON mu.muni_code = m.muni_code
    WHERE mu.public_municipality_id IS NOT NULL
      AND t.active IS TRUE
      AND m.population_yoy_delta IS NOT NULL
      AND m.muni_code = '352080') AS expected_rows;
-- public_rows = expected_rows = 23291 を確認

-- 2-2. グレイン一意性（重複ゼロ）と背骨(FK)・原則3(office_name)の充足。
SELECT
  count(*)                                          AS total_rows,
  count(*) - count(DISTINCT (muni_code, town_id, as_of)) AS dup_grain,        -- 0 であること
  count(*) FILTER (WHERE municipality_id IS NULL)   AS null_municipality_id,  -- 0
  count(*) FILTER (WHERE town_name IS NULL)          AS null_town_name,        -- 0
  count(DISTINCT town_id)                            AS towns,                  -- 557
  min(as_of) AS min_as_of, max(as_of) AS max_as_of
FROM public.town_monthly_metrics
WHERE muni_code = '352080';

-- 2-3. 確定/推定の分離が壊れていないか（推定行には必ず根拠 reason がある）。
SELECT
  count(*) FILTER (WHERE inferred_priority_rank IS NOT NULL
                     AND inferred_reason IS NULL) AS rank_without_reason,  -- 0 が望ましい
  count(*) FILTER (WHERE inferred_priority_rank NOT IN ('S','A','B','C','D')) AS bad_rank -- 0
FROM public.town_monthly_metrics
WHERE muni_code = '352080';

-- 2-4. サンプル目視（最新月の上位ランク町域）。
SELECT as_of, town_name, office_name,
       confirmed_households_yoy_delta, confirmed_population_yoy_delta,
       inferred_acquisition_score, inferred_priority_rank, inferred_reason
FROM public.town_monthly_metrics
WHERE muni_code = '352080'
  AND as_of = (SELECT max(as_of) FROM public.town_monthly_metrics WHERE muni_code = '352080')
ORDER BY inferred_acquisition_score DESC NULLS LAST
LIMIT 10;


-- ── STEP 3: RLS 動作確認 ────────────────────────────────────────────
-- 3-1. RLS 有効・ポリシー2件（platinum SELECT / service_role ALL）を確認。
SELECT relrowsecurity AS rls_enabled
FROM pg_class WHERE oid = 'public.town_monthly_metrics'::regclass;     -- t
SELECT policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'town_monthly_metrics'
ORDER BY policyname;

-- 3-2. anon / 非platinum authenticated は 0 行・platinum は閲覧可（ロール擬似）。
--   ※ SQL Editor は service_role（RLSバイパス）なので、RLS の効きは
--      ロールを切り替えて検証する。各ブロックは独立トランザクションで実行。

-- (a) anon: 0 行であること
BEGIN;
  SET LOCAL ROLE anon;
  SELECT count(*) AS anon_visible_rows FROM public.town_monthly_metrics;  -- 期待: 0
ROLLBACK;

-- (b) authenticated だが非platinum → 0 行。2パターンで確認する。
--   (b-1) 未ログイン相当（auth.uid()=NULL → current_user_plan()='free'）
BEGIN;
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims', '{}', true);
  SELECT public.current_user_plan() AS plan;                                     -- 期待: 'free'
  SELECT count(*) AS nulluid_visible_rows FROM public.town_monthly_metrics;      -- 期待: 0
ROLLBACK;
--   (b-2) 実在の非platinum契約者で status/plan ゲート本線を検証する。
--         <NONPLATINUM_USER_UUID> を subscriptions の非platinumユーザー
--         （plan='free'/'starter'/'standard' もしくは status≠active/past_due）に置換。
BEGIN;
  SET LOCAL ROLE authenticated;
  SELECT set_config(
    'request.jwt.claims',
    json_build_object('sub', '<NONPLATINUM_USER_UUID>', 'role', 'authenticated')::text,
    true);
  SELECT public.current_user_plan() AS plan;                                     -- 期待: 'platinum' 以外
  SELECT count(*) AS nonplatinum_visible_rows FROM public.town_monthly_metrics;  -- 期待: 0
ROLLBACK;

-- (c) platinum ユーザーで閲覧可（<PLATINUM_USER_UUID> を実在の platinum 契約者に置換）
--     その UUID が subscriptions に plan='platinum', status='active' で存在すること。
BEGIN;
  SET LOCAL ROLE authenticated;
  SELECT set_config(
    'request.jwt.claims',
    json_build_object('sub', '<PLATINUM_USER_UUID>', 'role', 'authenticated')::text,
    true);
  SELECT public.current_user_plan() AS plan;               -- 期待: 'platinum'
  SELECT count(*) AS platinum_visible_rows
  FROM public.town_monthly_metrics WHERE muni_code = '352080';  -- 期待: 23291
ROLLBACK;


-- ── STEP 4: 全国（全橋渡し自治体）─────────────────────────────────
-- 試走＋検算＋RLSがOKなら全国を流す。現状 public_municipality_id が
-- 設定済みなのは岩国のみのため、結果は岩国分と一致する（橋渡しが増えるたびに拡張）。
SELECT public.sync_town_monthly_metrics_from_iwakuni() AS upserted_rows_all;

-- 全国の最終確認（自治体別件数）。
SELECT muni_code, count(*) AS rows, count(DISTINCT town_id) AS towns,
       min(as_of) AS min_as_of, max(as_of) AS max_as_of
FROM public.town_monthly_metrics
GROUP BY muni_code
ORDER BY muni_code;
-- =====================================================================

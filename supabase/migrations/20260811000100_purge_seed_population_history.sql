-- ============================================================================
--  20260811000100_purge_seed_population_history.sql
--  municipalities.population_history のサンプル値を除去する【セッションG】
--
--  背景:
--    20260609000001_seed_population_history_sample.sql（6月）が投入した
--    サンプル値（線形補間／外挿）が、人口推移グラフに架空データとして
--    表示されていた（実測と最大約12倍乖離：例 名古屋市 seed=196,800 に対し
--    実測 2025 は大きく異なる）。人口推移の確定仕様は「国勢調査の実測3点
--    （2015/2020/2025）のみ・補間しない」であり、確定(事実)と推定を混ぜない
--    という絶対原則に照らしサンプル値は除去する。
--
--    対象は population_history が非NULL かつ要素を持つ行のみ（seed 投入の9件。
--    46201/46218/46203/04100/04202/04215/23100/23211/23202）。
--
--  本ファイルは PR #18 と独立。テーブルのデータのみ変更し、GRANT/REVOKE・
--  関数定義を一切触らないため、#18 の前に適用してよい（第1段として本日適用可）。
--  Migration 2b とも独立。
--
--  ⚠️ population_history カラム自体の削除・NULL DEFAULT 化は本セッションでは
--     行わない（カラムは温存）。値のみ NULL 化する。
--
--  復元用SQL（バックアップから戻す場合・service_role で実行）:
--    UPDATE public.municipalities mu
--    SET population_history = b.population_history
--    FROM iwakuni.bak_population_history_20260811 b
--    WHERE b.id = mu.id;
-- ============================================================================

BEGIN;

-- 1. 退避（バックアップ）: iwakuni（バックヤード・service_role のみ到達可）へ複製。
--    non-NULL かつ要素あり（jsonb_array_length > 0）の行だけを退避する。
CREATE TABLE IF NOT EXISTS iwakuni.bak_population_history_20260811 AS
  SELECT id, city_code, name, population_history, now() AS backed_up_at
  FROM public.municipalities
  WHERE population_history IS NOT NULL
    AND jsonb_array_length(population_history) > 0;

-- 2. RLS を最初から有効化（ポリシーは作らない＝service_role のみアクセス可）。
--    2026/8/8 に bak_public_tmm_20260703 で RLS 未設定を後追い修正した事案が
--    あったため、退避テーブルは作成直後に必ず有効化しておく。
ALTER TABLE iwakuni.bak_population_history_20260811 ENABLE ROW LEVEL SECURITY;

-- 3. サンプル値の除去（値のみ NULL 化・カラムは温存）。
UPDATE public.municipalities
SET population_history = NULL
WHERE population_history IS NOT NULL;

COMMIT;

-- ============================================================================
--  20260811000000_fix_population_history_gated_use_census.sql
--  人口推移グラフの供給源を「実測（国勢調査）」へ差し替える【セッションG】
--
--  背景:
--    RPC public.get_population_history_gated(p_city_code) は従来
--    municipalities.population_history（JSONB）を読んでいたが、その中身は
--    20260609000001_seed_population_history_sample.sql（6月）が投入した
--    サンプル値であり実データではない（保持は全1,916自治体中9件のみ・
--    名古屋市は実測の8.4%・豊田市は39.2%の値を表示していた）。
--    正しい実測は public.population_stats にあり、2015/2020/2025 の3点が
--    1,905自治体（99.4%）で揃う（data_source='census' / is_projected=false）。
--    既存 get_municipalities_gated は既に population_stats から
--    pop_latest(2025)/pop_prev(2020)/pop_prev2(2015) を返しており、本作業は
--    その設計への合流である。
--
--  適用順序（重要）:
--    - 本ファイルの適用は PR #18（feat/entitlement-v3-server）マージ後に行うこと。
--      #18 の 20260730000100_entitlement_v3_rpc.sql が同関数を「旧版
--      （population_history を読む）」で CREATE OR REPLACE するため、本ファイルは
--      必ずその後に適用しないと差し替えが上書きされてしまう。
--    - 本番の supabase_migrations.schema_migrations では #18 の3本が
--      リポジトリのファイル名（20260730000000/000100/000200）とは別の版番号
--      （20260730123112/123230/123352）で手動適用済みであり、リポジトリの
--      ファイル自体は台帳に未記録。このため #18 マージ後に db push すると
--      20260730000100 が「新規」として適用され旧版関数が復活し得る。
--      → 適用後は必ず pg_get_functiondef で本関数の定義（population_stats を
--        JOIN していること）を再検証すること。
--
--  Migration 2b とは独立。GRANT/REVOKE を一切変更しないため適用順序の制約なし
--  （関数本体の CREATE OR REPLACE のみ・権限や署名は不変）。
--
--  変更内容:
--    - 戻り値の型 TABLE(year integer, population bigint) は変更しない。
--    - population_stats を JOIN し、ps.year IN (2015,2020,2025) かつ
--      ps.population IS NOT NULL の行のみを year 昇順で返す（欠測年は行を返さない）。
--    - 既存の Free ロック判定（get_municipalities_gated の locked を参照する
--      NOT EXISTS 句）は一字一句そのまま維持（ここを緩めると Free 制限が破れる）。
--    - STABLE / SECURITY DEFINER / SET search_path = public, pg_temp を維持。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_population_history_gated(p_city_code text)
 RETURNS TABLE(year integer, population bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT ps.year, ps.population
  FROM public.municipalities mu
  JOIN public.population_stats ps ON ps.municipality_id = mu.id
  WHERE p_city_code ~ '^[0-9]{5}$'
    AND mu.city_code = p_city_code
    AND ps.year IN (2015, 2020, 2025)
    AND ps.population IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.get_municipalities_gated(mu.prefecture_code) g
      WHERE g.city_code = mu.city_code AND g.locked
    )
  ORDER BY ps.year;
$function$;

-- =====================================================================
-- 20260628000200_sync_iwakuni_town_monthly_metrics.sql  (T3 同期)
--
-- 目的:
--   バックヤード iwakuni.town_monthly_metrics（service_role 専用・正データ）を
--   製品側 public.town_monthly_metrics へ同期する関数を定義する。
--   要件定義v1.3 §5 の準完成形に相当する処理を、実スキーマで実装したもの。
--
-- 取り込み条件:
--   1. 橋渡し済み自治体のみ: iwakuni.municipality.public_municipality_id IS NOT NULL
--      （これにより public.municipalities への FK を必ず満たす。背骨＝原則2）
--   2. active 町域のみ: iwakuni.town.active IS TRUE
--   3. 前年比が算出可能な月のみ: population_yoy_delta IS NOT NULL
--      （前年同月の基準が無い時系列先頭の月を除外する。製品ルールとして
--        「YoYが取れる月＝population YoY の前年基準が存在する月」と定義する。
--        households_yoy_delta が NULL の月は確定NULLとしてそのまま保持する。
--        現データでは households YoY は population YoY の部分集合だが、これは
--        スキーマ制約ではなくデータ観察値であり、本条件は前者の製品ルールに基づく）
--   4. p_muni_code を指定した場合はその自治体のみ（1自治体試走用）。NULL なら全橋渡し自治体。
--
-- UPSERT:
--   一意キー (muni_code, town_id, as_of) で ON CONFLICT DO UPDATE。
--   自治体は公表値を後から修正するため、再実行で常に最新へ上書きできる（原則4）。
--
-- 確定/推定の対応（原則1: 列名で分離。iwakuni 側→public 側）:
--   households..age_65_plus_ratio → confirmed_*   （公表値ベースの確定差分）
--   demand_score..reason          → inferred_*    （ルールベース推定スコア＋根拠）
--
-- セキュリティ:
--   - SECURITY DEFINER: iwakuni（service_role 専用スキーマ）を読むため、
--     所有者(postgres)権限で実行する。EXECUTE は service_role のみに付与し、
--     authenticated/anon からは決して呼べないようにする。
--   - search_path を固定。
--
-- 注意（スコープ）:
--   UPSERT のみ。public 側で条件を外れた行（町域が非active化した等）の自動 DELETE は
--   行わない（公表済み履歴の破壊を避けるため・原則4のUPSERT方針）。purge が必要なら
--   別タスクで明示的に実装する。
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_town_monthly_metrics_from_iwakuni(
  p_muni_code text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, iwakuni, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.town_monthly_metrics AS tgt (
    municipality_id, muni_code, town_id, as_of,
    office_name, town_name, town_name_raw, lat, lng,
    confirmed_households, confirmed_population, confirmed_persons_per_hh,
    confirmed_households_mom_delta, confirmed_households_3m_delta,
    confirmed_households_6m_delta, confirmed_households_yoy_delta,
    confirmed_population_mom_delta, confirmed_population_3m_delta,
    confirmed_population_6m_delta, confirmed_population_yoy_delta,
    confirmed_age_0_14_delta, confirmed_age_20_39_delta, confirmed_age_30_49_delta,
    confirmed_age_65_plus_ratio,
    inferred_demand_score, inferred_sell_signal_score, inferred_supply_event_score,
    inferred_acquisition_score, inferred_priority_rank, inferred_reason,
    source_computed_at, synced_at
  )
  SELECT
    mu.public_municipality_id, m.muni_code, m.town_id, m.as_of,
    t.office_name, t.town_name, t.town_name_raw, t.lat, t.lng,
    m.households, m.population, m.persons_per_hh,
    m.households_mom_delta, m.households_3m_delta,
    m.households_6m_delta, m.households_yoy_delta,
    m.population_mom_delta, m.population_3m_delta,
    m.population_6m_delta, m.population_yoy_delta,
    m.age_0_14_delta, m.age_20_39_delta, m.age_30_49_delta,
    m.age_65_plus_ratio,
    m.demand_score, m.sell_signal_score, m.supply_event_score,
    m.acquisition_score, m.priority_rank, m.reason,
    m.computed_at, now()
  FROM iwakuni.town_monthly_metrics m
  JOIN iwakuni.town t
    ON t.muni_code = m.muni_code AND t.town_id = m.town_id
  JOIN iwakuni.municipality mu
    ON mu.muni_code = m.muni_code
  WHERE mu.public_municipality_id IS NOT NULL
    AND t.active IS TRUE
    AND m.population_yoy_delta IS NOT NULL
    AND (p_muni_code IS NULL OR m.muni_code = p_muni_code)
  ON CONFLICT (muni_code, town_id, as_of) DO UPDATE SET
    municipality_id               = EXCLUDED.municipality_id,
    office_name                   = EXCLUDED.office_name,
    town_name                     = EXCLUDED.town_name,
    town_name_raw                 = EXCLUDED.town_name_raw,
    lat                           = EXCLUDED.lat,
    lng                           = EXCLUDED.lng,
    confirmed_households          = EXCLUDED.confirmed_households,
    confirmed_population          = EXCLUDED.confirmed_population,
    confirmed_persons_per_hh      = EXCLUDED.confirmed_persons_per_hh,
    confirmed_households_mom_delta = EXCLUDED.confirmed_households_mom_delta,
    confirmed_households_3m_delta  = EXCLUDED.confirmed_households_3m_delta,
    confirmed_households_6m_delta  = EXCLUDED.confirmed_households_6m_delta,
    confirmed_households_yoy_delta = EXCLUDED.confirmed_households_yoy_delta,
    confirmed_population_mom_delta = EXCLUDED.confirmed_population_mom_delta,
    confirmed_population_3m_delta  = EXCLUDED.confirmed_population_3m_delta,
    confirmed_population_6m_delta  = EXCLUDED.confirmed_population_6m_delta,
    confirmed_population_yoy_delta = EXCLUDED.confirmed_population_yoy_delta,
    confirmed_age_0_14_delta      = EXCLUDED.confirmed_age_0_14_delta,
    confirmed_age_20_39_delta     = EXCLUDED.confirmed_age_20_39_delta,
    confirmed_age_30_49_delta     = EXCLUDED.confirmed_age_30_49_delta,
    confirmed_age_65_plus_ratio   = EXCLUDED.confirmed_age_65_plus_ratio,
    inferred_demand_score         = EXCLUDED.inferred_demand_score,
    inferred_sell_signal_score    = EXCLUDED.inferred_sell_signal_score,
    inferred_supply_event_score   = EXCLUDED.inferred_supply_event_score,
    inferred_acquisition_score    = EXCLUDED.inferred_acquisition_score,
    inferred_priority_rank        = EXCLUDED.inferred_priority_rank,
    inferred_reason               = EXCLUDED.inferred_reason,
    source_computed_at            = EXCLUDED.source_computed_at,
    synced_at                     = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.sync_town_monthly_metrics_from_iwakuni(text) IS
  'iwakuni.town_monthly_metrics → public.town_monthly_metrics 同期。'
  'active町域・YoY算出可能月・橋渡し済み自治体のみ。(muni_code,town_id,as_of)でUPSERT。'
  '引数で1自治体に限定可（NULL=全橋渡し自治体）。戻り値=UPSERT行数。service_role専用。';

REVOKE ALL ON FUNCTION public.sync_town_monthly_metrics_from_iwakuni(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_town_monthly_metrics_from_iwakuni(text) TO service_role;

COMMIT;

-- =====================================================================
-- 適用後の使い方（PO が service_role 文脈＝SQL Editor で実行）
--   -- 岩国(352080) 1自治体 試走:
--   SELECT public.sync_town_monthly_metrics_from_iwakuni('352080');   -- 期待: 23291
--   -- 全橋渡し自治体（現状は岩国のみ橋渡し済み）:
--   SELECT public.sync_town_monthly_metrics_from_iwakuni();
-- =====================================================================

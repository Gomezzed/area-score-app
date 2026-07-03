-- sync_iwakuni_to_public.sql
-- Target project: Supabase area-score-app / bstohiamtnlgcjulgedy
-- Based only on actual columns and actual PK/UNIQUE constraints recorded in:
--   scripts/reports/sync_gap_20260703.md
--
-- Phase A is read-only dry-run SQL.
-- Phase B is for PO-approved execution only. It is guarded by app.po_approved.
--
-- Notes:
-- - Do not reference the public young-analysis town table.
-- - Do not change RLS or GRANT.
-- - Do not TRUNCATE, DELETE, or DROP.
-- - The only allowed DDL in Phase B is the backup table creation in iwakuni.

-- =====================================================================
-- Phase A-1: bridge preview, read-only
-- =====================================================================

WITH bridge_candidates AS (
  SELECT
    i.muni_code,
    i.pref_name,
    i.muni_name,
    i.muni_type,
    i.is_target,
    i.public_municipality_id,
    LEFT(i.muni_code, 5) AS match_city_code,
    COUNT(p.id) AS public_match_candidates,
    ARRAY_AGG(p.id ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL) AS matched_public_ids,
    ARRAY_AGG(p.name ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL) AS matched_public_names
  FROM iwakuni.municipality AS i
  LEFT JOIN public.municipalities AS p
    ON LEFT(i.muni_code, 5) = p.city_code
  GROUP BY
    i.muni_code, i.pref_name, i.muni_name, i.muni_type,
    i.is_target, i.public_municipality_id, LEFT(i.muni_code, 5)
), summary AS (
  SELECT
    COUNT(*) AS iwakuni_municipality_rows,
    COUNT(*) FILTER (WHERE public_municipality_id IS NULL) AS current_bridge_null_rows,
    COUNT(*) FILTER (WHERE public_municipality_id IS NOT NULL) AS current_bridge_nonnull_rows,
    COUNT(*) FILTER (WHERE public_municipality_id IS NULL AND public_match_candidates = 1) AS null_rows_exactly_one_match,
    COUNT(*) FILTER (WHERE public_municipality_id IS NULL AND public_match_candidates = 0) AS null_rows_no_match,
    COUNT(*) FILTER (WHERE public_municipality_id IS NULL AND public_match_candidates > 1) AS null_rows_multiple_matches,
    COUNT(*) FILTER (WHERE public_match_candidates = 1) AS all_rows_exactly_one_match,
    COUNT(*) FILTER (WHERE public_match_candidates = 0) AS all_rows_no_match,
    COUNT(*) FILTER (WHERE public_match_candidates > 1) AS all_rows_multiple_matches
  FROM bridge_candidates
), iwakuni_status AS (
  SELECT *
  FROM bridge_candidates
  WHERE muni_code = '352080' OR muni_name = '岩国市'
), unmatched_nulls AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'muni_code', muni_code,
    'pref_name', pref_name,
    'muni_name', muni_name,
    'muni_type', muni_type,
    'match_city_code', match_city_code
  ) ORDER BY muni_code), '[]'::jsonb) AS rows
  FROM bridge_candidates
  WHERE public_municipality_id IS NULL
    AND public_match_candidates = 0
), multiple_nulls AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'muni_code', muni_code,
    'pref_name', pref_name,
    'muni_name', muni_name,
    'muni_type', muni_type,
    'match_city_code', match_city_code,
    'public_match_candidates', public_match_candidates,
    'matched_public_ids', matched_public_ids,
    'matched_public_names', matched_public_names
  ) ORDER BY muni_code), '[]'::jsonb) AS rows
  FROM bridge_candidates
  WHERE public_municipality_id IS NULL
    AND public_match_candidates > 1
)
SELECT jsonb_build_object(
  'summary', to_jsonb(summary),
  'iwakuni_bridge_status', (
    SELECT COALESCE(jsonb_agg(to_jsonb(iwakuni_status) ORDER BY muni_code), '[]'::jsonb)
    FROM iwakuni_status
  ),
  'unmatched_null_municipalities', unmatched_nulls.rows,
  'multiple_match_null_municipalities', multiple_nulls.rows
) AS phase_a_1_bridge_preview
FROM summary, unmatched_nulls, multiple_nulls;

-- =====================================================================
-- Phase A-2: Iwakuni duplicate check, read-only
-- =====================================================================

WITH iwakuni_candidate_raw AS (
  SELECT
    i.muni_code,
    i.muni_name,
    i.public_municipality_id AS current_public_municipality_id,
    LEFT(i.muni_code, 5) AS match_city_code,
    COUNT(p.id) AS public_match_candidates,
    ARRAY_AGG(p.id ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL) AS matched_public_ids,
    ARRAY_AGG(p.name ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL) AS matched_public_names
  FROM iwakuni.municipality AS i
  LEFT JOIN public.municipalities AS p
    ON LEFT(i.muni_code, 5) = p.city_code
  WHERE i.muni_code = '352080' OR i.muni_name = '岩国市'
  GROUP BY i.muni_code, i.muni_name, i.public_municipality_id, LEFT(i.muni_code, 5)
), iwakuni_candidate AS (
  SELECT
    *,
    matched_public_ids[1] AS matched_public_municipality_id
  FROM iwakuni_candidate_raw
), public_existing_raw AS (
  SELECT
    COUNT(*) AS public_tmm_rows,
    COUNT(DISTINCT municipality_id) AS distinct_municipality_id_count,
    ARRAY_AGG(DISTINCT municipality_id ORDER BY municipality_id) AS distinct_municipality_ids,
    COUNT(DISTINCT muni_code) AS distinct_muni_code_count,
    ARRAY_AGG(DISTINCT muni_code ORDER BY muni_code) AS distinct_muni_codes
  FROM public.town_monthly_metrics
), public_existing AS (
  SELECT
    *,
    distinct_municipality_ids[1] AS sole_municipality_id
  FROM public_existing_raw
)
SELECT jsonb_build_object(
  'iwakuni_candidate', to_jsonb(iwakuni_candidate),
  'public_existing', to_jsonb(public_existing),
  'check_passed', (
    iwakuni_candidate.public_match_candidates = 1
    AND public_existing.distinct_municipality_id_count = 1
    AND public_existing.sole_municipality_id = iwakuni_candidate.matched_public_municipality_id
  )
) AS phase_a_2_iwakuni_duplicate_check
FROM iwakuni_candidate, public_existing;

-- =====================================================================
-- Phase A-3: sync preview, read-only
-- S4 definition used here:
--   demand_score, sell_signal_score, supply_event_score, acquisition_score
--   are all non-NULL in at least one source row for the municipality.
-- =====================================================================

WITH bridge_candidates_raw AS (
  SELECT
    i.muni_code,
    i.pref_name,
    i.muni_name,
    i.muni_type,
    i.public_municipality_id,
    LEFT(i.muni_code, 5) AS match_city_code,
    COUNT(p.id) AS public_match_candidates,
    ARRAY_AGG(p.id ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL) AS matched_public_ids,
    ARRAY_AGG(p.name ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL) AS matched_public_names
  FROM iwakuni.municipality AS i
  LEFT JOIN public.municipalities AS p
    ON LEFT(i.muni_code, 5) = p.city_code
  GROUP BY
    i.muni_code, i.pref_name, i.muni_name, i.muni_type,
    i.public_municipality_id, LEFT(i.muni_code, 5)
), bridge_candidates AS (
  SELECT
    *,
    CASE WHEN public_match_candidates = 1 THEN matched_public_ids[1] END AS exactly_one_matched_public_id,
    COALESCE(
      public_municipality_id,
      CASE WHEN public_match_candidates = 1 THEN matched_public_ids[1] END
    ) AS effective_public_municipality_id
  FROM bridge_candidates_raw
), quality AS (
  SELECT
    m.muni_code,
    COUNT(*) AS metric_rows,
    COUNT(DISTINCT date_trunc('month', m.as_of)::date) AS distinct_as_of_months,
    COUNT(m.households) AS households_nonnull_rows,
    BOOL_OR(m.households IS NOT NULL) AS has_households,
    COUNT(*) FILTER (
      WHERE m.demand_score IS NOT NULL
        AND m.sell_signal_score IS NOT NULL
        AND m.supply_event_score IS NOT NULL
        AND m.acquisition_score IS NOT NULL
    ) AS score4_complete_rows,
    BOOL_OR(
      m.demand_score IS NOT NULL
      AND m.sell_signal_score IS NOT NULL
      AND m.supply_event_score IS NOT NULL
      AND m.acquisition_score IS NOT NULL
    ) AS has_s4_score_data,
    COUNT(m.priority_rank) AS priority_rank_nonnull_rows,
    COUNT(m.reason) AS reason_nonnull_rows,
    MIN(m.as_of) AS min_as_of,
    MAX(m.as_of) AS max_as_of
  FROM iwakuni.town_monthly_metrics AS m
  GROUP BY m.muni_code
), p1_quality AS (
  SELECT
    b.muni_code,
    b.pref_name,
    b.muni_name,
    COALESCE(q.metric_rows, 0) AS metric_rows,
    COALESCE(q.distinct_as_of_months, 0) AS distinct_as_of_months,
    COALESCE(q.households_nonnull_rows, 0) AS households_nonnull_rows,
    COALESCE(q.has_households, false) AS has_households,
    q.min_as_of,
    q.max_as_of
  FROM bridge_candidates AS b
  LEFT JOIN quality AS q ON q.muni_code = b.muni_code
  WHERE COALESCE(q.distinct_as_of_months, 0) >= 13
    AND COALESCE(q.has_households, false)
), eligible AS (
  SELECT
    b.muni_code,
    b.pref_name,
    b.muni_name,
    b.muni_type,
    b.public_municipality_id AS current_public_municipality_id,
    b.exactly_one_matched_public_id,
    b.effective_public_municipality_id,
    COALESCE(q.metric_rows, 0) AS upsert_rows_preview,
    COALESCE(q.distinct_as_of_months, 0) AS distinct_as_of_months,
    COALESCE(q.households_nonnull_rows, 0) AS households_nonnull_rows,
    COALESCE(q.has_households, false) AS has_households,
    COALESCE(q.score4_complete_rows, 0) AS score4_complete_rows,
    COALESCE(q.has_s4_score_data, false) AS has_s4_score_data,
    COALESCE(q.priority_rank_nonnull_rows, 0) AS priority_rank_nonnull_rows,
    COALESCE(q.reason_nonnull_rows, 0) AS reason_nonnull_rows,
    q.min_as_of,
    q.max_as_of
  FROM bridge_candidates AS b
  LEFT JOIN quality AS q ON q.muni_code = b.muni_code
  WHERE COALESCE(q.distinct_as_of_months, 0) >= 13
    AND COALESCE(q.has_households, false)
    AND COALESCE(q.has_s4_score_data, false)
    AND b.effective_public_municipality_id IS NOT NULL
), compare AS (
  SELECT
    (SELECT COUNT(*) FROM p1_quality) AS p1_quality_count,
    (SELECT COUNT(*) FROM eligible) AS phase_a3_eligible_count,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('muni_code', p.muni_code, 'pref_name', p.pref_name, 'muni_name', p.muni_name) ORDER BY p.muni_code), '[]'::jsonb)
     FROM p1_quality AS p
     WHERE NOT EXISTS (SELECT 1 FROM eligible AS e WHERE e.muni_code = p.muni_code)) AS p1_missing_from_phase_a3,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('muni_code', e.muni_code, 'pref_name', e.pref_name, 'muni_name', e.muni_name) ORDER BY e.muni_code), '[]'::jsonb)
     FROM eligible AS e
     WHERE NOT EXISTS (SELECT 1 FROM p1_quality AS p WHERE p.muni_code = e.muni_code)) AS phase_a3_extra_vs_p1
)
SELECT jsonb_build_object(
  's4_definition', 'demand_score, sell_signal_score, supply_event_score, acquisition_score are all non-NULL in at least one source row',
  'eligible_municipalities', (
    SELECT COALESCE(jsonb_agg(to_jsonb(eligible) ORDER BY muni_code), '[]'::jsonb)
    FROM eligible
  ),
  'compare_with_p1_quality_ok', to_jsonb(compare),
  'total_upsert_rows_preview', (SELECT COALESCE(SUM(upsert_rows_preview), 0) FROM eligible)
) AS phase_a_3_sync_preview
FROM compare;

-- =====================================================================
-- Phase B: PO-approved write path only. NOT executed during Phase A.
-- To execute Phase B after explicit approval:
--   BEGIN;
--   SET app.po_approved = 'true';
--   run the Phase B statements below in the same SQL batch;
--   COMMIT;
-- =====================================================================

BEGIN;
SET app.po_approved = 'true';

DO $$
BEGIN
  IF current_setting('app.po_approved', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Phase B blocked: set app.po_approved=true only after PO approval';
  END IF;
END $$;

-- Phase B-0: backup in iwakuni schema only.
CREATE TABLE iwakuni.bak_public_tmm_20260703 AS
SELECT *
FROM public.town_monthly_metrics;

DO $$
DECLARE
  backup_count bigint;
BEGIN
  SELECT COUNT(*) INTO backup_count
  FROM iwakuni.bak_public_tmm_20260703;

  IF backup_count <> 23291 THEN
    RAISE EXCEPTION 'B-0 backup row count mismatch: expected 23291, got %', backup_count;
  END IF;
END $$;

-- Phase B-1: bridge NULL rows only, exact single public match only.
WITH bridge_candidates_raw AS (
  SELECT
    i.muni_code,
    COUNT(p.id) AS public_match_candidates,
    ARRAY_AGG(p.id ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL) AS matched_public_ids
  FROM iwakuni.municipality AS i
  LEFT JOIN public.municipalities AS p
    ON LEFT(i.muni_code, 5) = p.city_code
  WHERE i.public_municipality_id IS NULL
  GROUP BY i.muni_code
), bridge_candidates AS (
  SELECT
    muni_code,
    matched_public_ids[1] AS matched_public_municipality_id
  FROM bridge_candidates_raw
  WHERE public_match_candidates = 1
)
UPDATE iwakuni.municipality AS i
SET public_municipality_id = b.matched_public_municipality_id
FROM bridge_candidates AS b
WHERE i.muni_code = b.muni_code
  AND i.public_municipality_id IS NULL
RETURNING
  i.muni_code,
  i.pref_name,
  i.muni_name,
  i.public_municipality_id;

-- Phase B-1 manual resolution list, if any.
WITH bridge_candidates AS (
  SELECT
    i.muni_code,
    i.pref_name,
    i.muni_name,
    i.muni_type,
    LEFT(i.muni_code, 5) AS match_city_code,
    COUNT(p.id) AS public_match_candidates,
    ARRAY_AGG(p.id ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL) AS matched_public_ids,
    ARRAY_AGG(p.name ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL) AS matched_public_names
  FROM iwakuni.municipality AS i
  LEFT JOIN public.municipalities AS p
    ON LEFT(i.muni_code, 5) = p.city_code
  WHERE i.public_municipality_id IS NULL
  GROUP BY
    i.muni_code, i.pref_name, i.muni_name, i.muni_type, LEFT(i.muni_code, 5)
)
SELECT *
FROM bridge_candidates
WHERE public_match_candidates <> 1
ORDER BY muni_code;

-- Phase B-2: upsert eligible source rows.
-- The ON CONFLICT target exactly matches the actual public PK:
--   public.town_monthly_metrics (muni_code, town_id, as_of)
WITH quality AS (
  SELECT
    m.muni_code,
    COUNT(DISTINCT date_trunc('month', m.as_of)::date) AS distinct_as_of_months,
    BOOL_OR(m.households IS NOT NULL) AS has_households,
    BOOL_OR(
      m.demand_score IS NOT NULL
      AND m.sell_signal_score IS NOT NULL
      AND m.supply_event_score IS NOT NULL
      AND m.acquisition_score IS NOT NULL
    ) AS has_s4_score_data
  FROM iwakuni.town_monthly_metrics AS m
  GROUP BY m.muni_code
), eligible_municipalities AS (
  SELECT
    i.muni_code,
    i.public_municipality_id
  FROM iwakuni.municipality AS i
  JOIN quality AS q ON q.muni_code = i.muni_code
  WHERE i.public_municipality_id IS NOT NULL
    AND q.distinct_as_of_months >= 13
    AND q.has_households
    AND q.has_s4_score_data
)
INSERT INTO public.town_monthly_metrics (
  municipality_id,
  muni_code,
  town_id,
  as_of,
  office_name,
  town_name,
  town_name_raw,
  lat,
  lng,
  confirmed_households,
  confirmed_population,
  confirmed_persons_per_hh,
  confirmed_households_mom_delta,
  confirmed_households_3m_delta,
  confirmed_households_6m_delta,
  confirmed_households_yoy_delta,
  confirmed_population_mom_delta,
  confirmed_population_3m_delta,
  confirmed_population_6m_delta,
  confirmed_population_yoy_delta,
  confirmed_age_0_14_delta,
  confirmed_age_20_39_delta,
  confirmed_age_30_49_delta,
  confirmed_age_65_plus_ratio,
  inferred_demand_score,
  inferred_sell_signal_score,
  inferred_supply_event_score,
  inferred_acquisition_score,
  inferred_priority_rank,
  inferred_reason,
  source_computed_at,
  synced_at
)
SELECT
  e.public_municipality_id,
  m.muni_code,
  m.town_id,
  m.as_of,
  t.office_name,
  t.town_name,
  t.town_name_raw,
  t.lat,
  t.lng,
  m.households,
  m.population,
  m.persons_per_hh,
  m.households_mom_delta,
  m.households_3m_delta,
  m.households_6m_delta,
  m.households_yoy_delta,
  m.population_mom_delta,
  m.population_3m_delta,
  m.population_6m_delta,
  m.population_yoy_delta,
  m.age_0_14_delta,
  m.age_20_39_delta,
  m.age_30_49_delta,
  m.age_65_plus_ratio,
  m.demand_score,
  m.sell_signal_score,
  m.supply_event_score,
  m.acquisition_score,
  m.priority_rank,
  m.reason,
  m.computed_at,
  now()
FROM iwakuni.town_monthly_metrics AS m
JOIN eligible_municipalities AS e
  ON e.muni_code = m.muni_code
JOIN iwakuni.town AS t
  ON t.town_id = m.town_id
 AND t.muni_code = m.muni_code
ON CONFLICT (muni_code, town_id, as_of) DO UPDATE SET
  municipality_id = EXCLUDED.municipality_id,
  office_name = EXCLUDED.office_name,
  town_name = EXCLUDED.town_name,
  town_name_raw = EXCLUDED.town_name_raw,
  lat = EXCLUDED.lat,
  lng = EXCLUDED.lng,
  confirmed_households = EXCLUDED.confirmed_households,
  confirmed_population = EXCLUDED.confirmed_population,
  confirmed_persons_per_hh = EXCLUDED.confirmed_persons_per_hh,
  confirmed_households_mom_delta = EXCLUDED.confirmed_households_mom_delta,
  confirmed_households_3m_delta = EXCLUDED.confirmed_households_3m_delta,
  confirmed_households_6m_delta = EXCLUDED.confirmed_households_6m_delta,
  confirmed_households_yoy_delta = EXCLUDED.confirmed_households_yoy_delta,
  confirmed_population_mom_delta = EXCLUDED.confirmed_population_mom_delta,
  confirmed_population_3m_delta = EXCLUDED.confirmed_population_3m_delta,
  confirmed_population_6m_delta = EXCLUDED.confirmed_population_6m_delta,
  confirmed_population_yoy_delta = EXCLUDED.confirmed_population_yoy_delta,
  confirmed_age_0_14_delta = EXCLUDED.confirmed_age_0_14_delta,
  confirmed_age_20_39_delta = EXCLUDED.confirmed_age_20_39_delta,
  confirmed_age_30_49_delta = EXCLUDED.confirmed_age_30_49_delta,
  confirmed_age_65_plus_ratio = EXCLUDED.confirmed_age_65_plus_ratio,
  inferred_demand_score = EXCLUDED.inferred_demand_score,
  inferred_sell_signal_score = EXCLUDED.inferred_sell_signal_score,
  inferred_supply_event_score = EXCLUDED.inferred_supply_event_score,
  inferred_acquisition_score = EXCLUDED.inferred_acquisition_score,
  inferred_priority_rank = EXCLUDED.inferred_priority_rank,
  inferred_reason = EXCLUDED.inferred_reason,
  source_computed_at = EXCLUDED.source_computed_at,
  synced_at = EXCLUDED.synced_at;

COMMIT;

-- Phase B-3: post-sync validation.
WITH quality AS (
  SELECT
    m.muni_code,
    COUNT(*) AS expected_rows,
    COUNT(DISTINCT date_trunc('month', m.as_of)::date) AS distinct_as_of_months,
    BOOL_OR(m.households IS NOT NULL) AS has_households,
    BOOL_OR(
      m.demand_score IS NOT NULL
      AND m.sell_signal_score IS NOT NULL
      AND m.supply_event_score IS NOT NULL
      AND m.acquisition_score IS NOT NULL
    ) AS has_s4_score_data
  FROM iwakuni.town_monthly_metrics AS m
  GROUP BY m.muni_code
), expected AS (
  SELECT
    i.muni_code,
    i.pref_name,
    i.muni_name,
    i.public_municipality_id,
    q.expected_rows
  FROM iwakuni.municipality AS i
  JOIN quality AS q ON q.muni_code = i.muni_code
  WHERE i.public_municipality_id IS NOT NULL
    AND q.distinct_as_of_months >= 13
    AND q.has_households
    AND q.has_s4_score_data
), actual AS (
  SELECT
    p.muni_code,
    p.municipality_id,
    COUNT(*) AS actual_rows
  FROM public.town_monthly_metrics AS p
  JOIN expected AS e ON e.muni_code = p.muni_code
  GROUP BY p.muni_code, p.municipality_id
), per_municipality AS (
  SELECT
    e.muni_code,
    e.pref_name,
    e.muni_name,
    e.public_municipality_id,
    e.expected_rows,
    COALESCE(a.actual_rows, 0) AS actual_rows,
    (COALESCE(a.actual_rows, 0) = e.expected_rows) AS row_count_matches
  FROM expected AS e
  LEFT JOIN actual AS a
    ON a.muni_code = e.muni_code
   AND a.municipality_id = e.public_municipality_id
), upsert_source_keys AS (
  SELECT
    m.muni_code,
    m.town_id,
    m.as_of
  FROM iwakuni.town_monthly_metrics AS m
  JOIN expected AS e ON e.muni_code = m.muni_code
), orphan_existing_public AS (
  SELECT
    b.muni_code,
    b.municipality_id,
    COUNT(*) AS orphan_rows
  FROM iwakuni.bak_public_tmm_20260703 AS b
  LEFT JOIN upsert_source_keys AS s
    ON s.muni_code = b.muni_code
   AND s.town_id = b.town_id
   AND s.as_of = b.as_of
  WHERE s.muni_code IS NULL
  GROUP BY b.muni_code, b.municipality_id
)
SELECT jsonb_build_object(
  'backup_table', 'iwakuni.bak_public_tmm_20260703',
  'backup_rows', (SELECT COUNT(*) FROM iwakuni.bak_public_tmm_20260703),
  'public_total_rows', (SELECT COUNT(*) FROM public.town_monthly_metrics),
  'public_distinct_municipality_id', (SELECT COUNT(DISTINCT municipality_id) FROM public.town_monthly_metrics),
  'public_distinct_muni_code', (SELECT COUNT(DISTINCT muni_code) FROM public.town_monthly_metrics),
  'expected_total_rows', (SELECT COALESCE(SUM(expected_rows), 0) FROM expected),
  'per_municipality', (
    SELECT COALESCE(jsonb_agg(to_jsonb(per_municipality) ORDER BY muni_code), '[]'::jsonb)
    FROM per_municipality
  ),
  'all_expected_counts_match', (
    SELECT COALESCE(BOOL_AND(row_count_matches), false)
    FROM per_municipality
  ),
  'orphan_existing_public_rows', (SELECT COALESCE(SUM(orphan_rows), 0) FROM orphan_existing_public),
  'orphan_existing_public_breakdown', (
    SELECT COALESCE(jsonb_agg(to_jsonb(orphan_existing_public) ORDER BY muni_code, municipality_id), '[]'::jsonb)
    FROM orphan_existing_public
  ),
  'bridge_null_remaining', (SELECT COUNT(*) FROM iwakuni.municipality WHERE public_municipality_id IS NULL)
) AS phase_b_3_post_sync_validation;

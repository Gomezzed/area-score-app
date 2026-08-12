-- S6(5af8d3f)がselectに追加した inferred_acquisition_score をビューに追加する。
-- CREATE OR REPLACE のため列は末尾追加。ACL・security_invoker・RLSポリシーは保持される。
CREATE OR REPLACE VIEW public.customer_list_town_latest
WITH (security_invoker = on) AS
SELECT t.municipality_id,
       m.name AS municipality_name,
       t.town_id,
       t.town_name,
       t.town_name_raw,
       t.office_name,
       t.as_of,
       t.inferred_priority_rank,
       t.inferred_reason,
       t.inferred_acquisition_score
FROM public.town_monthly_metrics t
JOIN public.municipalities m ON m.id = t.municipality_id
JOIN (
  SELECT municipality_id, max(as_of) AS as_of
  FROM public.town_monthly_metrics
  GROUP BY municipality_id
) latest
  ON latest.municipality_id = t.municipality_id
 AND latest.as_of = t.as_of;

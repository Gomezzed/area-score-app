-- O20: ETL同期関数(SECURITY DEFINER, owner=postgres)を anon/authenticated から遮断
REVOKE EXECUTE ON FUNCTION public.sync_town_monthly_metrics_from_iwakuni(text)
  FROM anon, authenticated;

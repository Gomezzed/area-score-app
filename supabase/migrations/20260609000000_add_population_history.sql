-- ============================================================================
--  20260609000000_add_population_history.sql
--  Phase 2 #7「人口推移グラフ」(MVP A-1)
--
--  municipalities テーブルに population_history (JSONB) カラムを追加する。
--  形式: [{"year": 2015, "population": N}, ... , {"year": 2025, "population": N}]
--    - 2015 / 2020 は国勢調査（総務省統計局 e-Stat）の実測値
--    - 2016〜2019 / 2021〜2025 は線形補間（fetch_population_history.py が生成）
--
--  注: 仕様書は legacy `areas` テーブルを対象としていたが、ライブの詳細パネル
--      (MunicipalityDetailPanel) は municipalities/population_stats 系で駆動して
--      いるため、実際に描画される municipalities 側へカラムを追加する。
--      RLS は 20260607000003 で municipalities に authenticated SELECT 済み（無変更）。
-- ============================================================================

ALTER TABLE public.municipalities
  ADD COLUMN IF NOT EXISTS population_history JSONB;

COMMENT ON COLUMN public.municipalities.population_history IS
  '人口推移（2015〜2025）。[{"year":2015,"population":N},...] 形式。2015/2020 は国勢調査実測、間の年は線形補間。Phase 2 #7 MVP A-1。';

CREATE INDEX IF NOT EXISTS idx_municipalities_population_history
  ON public.municipalities USING GIN (population_history);

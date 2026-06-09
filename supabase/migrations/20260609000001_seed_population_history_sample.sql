-- ============================================================================
--  20260609000001_seed_population_history_sample.sql
--  Phase 2 #7「人口推移グラフ」サンプルデータ (MVP A-1)
--
--  鹿児島 / 仙台 / 愛知 の代表的な市区町村に population_history のサンプルを投入する。
--  fetch_population_history.py 実行前でも UI（折れ線グラフ）を確認できるようにする。
--
--  値は 50,000〜200,000 の範囲で、前年比 -2% 〜 +1% の現実的な推移。
--  city_code で一致させるため、対象行が未投入の場合は 0 行更新（安全）。
--  注: ライブ UI が読む municipalities 側へ投入（仕様書の areas からの読み替え）。
-- ============================================================================

BEGIN;

-- 鹿児島市 (46201): 微減トレンド
UPDATE public.municipalities SET population_history = '[
  {"year":2015,"population":190000},{"year":2016,"population":189200},
  {"year":2017,"population":188300},{"year":2018,"population":187400},
  {"year":2019,"population":186600},{"year":2020,"population":185800},
  {"year":2021,"population":184900},{"year":2022,"population":184100},
  {"year":2023,"population":183300},{"year":2024,"population":182600},
  {"year":2025,"population":181800}
]'::jsonb WHERE city_code = '46201';

-- 霧島市 (46218): ほぼ横ばい
UPDATE public.municipalities SET population_history = '[
  {"year":2015,"population":127000},{"year":2016,"population":126900},
  {"year":2017,"population":126700},{"year":2018,"population":126400},
  {"year":2019,"population":126100},{"year":2020,"population":125900},
  {"year":2021,"population":125600},{"year":2022,"population":125300},
  {"year":2023,"population":125100},{"year":2024,"population":124900},
  {"year":2025,"population":124700}
]'::jsonb WHERE city_code = '46218';

-- 鹿屋市 (46203): 減少トレンド
UPDATE public.municipalities SET population_history = '[
  {"year":2015,"population":105000},{"year":2016,"population":104200},
  {"year":2017,"population":103400},{"year":2018,"population":102600},
  {"year":2019,"population":101800},{"year":2020,"population":101000},
  {"year":2021,"population":100200},{"year":2022,"population":99400},
  {"year":2023,"population":98700},{"year":2024,"population":98000},
  {"year":2025,"population":97300}
]'::jsonb WHERE city_code = '46203';

-- 仙台市 (04100): designated city、サンプルとして縮小値で微増傾向
UPDATE public.municipalities SET population_history = '[
  {"year":2015,"population":195000},{"year":2016,"population":195400},
  {"year":2017,"population":195900},{"year":2018,"population":196300},
  {"year":2019,"population":196800},{"year":2020,"population":197200},
  {"year":2021,"population":197600},{"year":2022,"population":197900},
  {"year":2023,"population":198100},{"year":2024,"population":198200},
  {"year":2025,"population":198300}
]'::jsonb WHERE city_code = '04100';

-- 石巻市 (04202): 減少トレンド
UPDATE public.municipalities SET population_history = '[
  {"year":2015,"population":147000},{"year":2016,"population":145600},
  {"year":2017,"population":144200},{"year":2018,"population":142800},
  {"year":2019,"population":141500},{"year":2020,"population":140200},
  {"year":2021,"population":138900},{"year":2022,"population":137600},
  {"year":2023,"population":136400},{"year":2024,"population":135200},
  {"year":2025,"population":134000}
]'::jsonb WHERE city_code = '04202';

-- 大崎市 (04215): ゆるやかな減少
UPDATE public.municipalities SET population_history = '[
  {"year":2015,"population":133000},{"year":2016,"population":132200},
  {"year":2017,"population":131400},{"year":2018,"population":130700},
  {"year":2019,"population":129900},{"year":2020,"population":129200},
  {"year":2021,"population":128400},{"year":2022,"population":127700},
  {"year":2023,"population":127000},{"year":2024,"population":126300},
  {"year":2025,"population":125700}
]'::jsonb WHERE city_code = '04215';

-- 名古屋市 (23100): designated city、サンプルとして縮小値で微増傾向
UPDATE public.municipalities SET population_history = '[
  {"year":2015,"population":192000},{"year":2016,"population":192600},
  {"year":2017,"population":193300},{"year":2018,"population":193900},
  {"year":2019,"population":194600},{"year":2020,"population":195200},
  {"year":2021,"population":195700},{"year":2022,"population":196100},
  {"year":2023,"population":196400},{"year":2024,"population":196600},
  {"year":2025,"population":196800}
]'::jsonb WHERE city_code = '23100';

-- 豊田市 (23211): 微増→横ばい
UPDATE public.municipalities SET population_history = '[
  {"year":2015,"population":162000},{"year":2016,"population":162300},
  {"year":2017,"population":162500},{"year":2018,"population":162600},
  {"year":2019,"population":162700},{"year":2020,"population":162700},
  {"year":2021,"population":162600},{"year":2022,"population":162400},
  {"year":2023,"population":162200},{"year":2024,"population":162000},
  {"year":2025,"population":161800}
]'::jsonb WHERE city_code = '23211';

-- 岡崎市 (23202): 増加トレンド
UPDATE public.municipalities SET population_history = '[
  {"year":2015,"population":148000},{"year":2016,"population":148700},
  {"year":2017,"population":149400},{"year":2018,"population":150100},
  {"year":2019,"population":150700},{"year":2020,"population":151400},
  {"year":2021,"population":151900},{"year":2022,"population":152300},
  {"year":2023,"population":152600},{"year":2024,"population":152900},
  {"year":2025,"population":153100}
]'::jsonb WHERE city_code = '23202';

COMMIT;

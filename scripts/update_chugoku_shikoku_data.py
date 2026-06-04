#!/usr/bin/env python3
"""中国・四国 人口データ更新スクリプト (e-Stat 住民基本台帳)

対象都道府県: 鳥取(31), 島根(32), 岡山(33), 広島(34), 山口(35),
              徳島(36), 香川(37), 愛媛(38), 高知(39)
"""

from __future__ import annotations
import os, sys, logging
from datetime import datetime
from _common import (
    get_supabase_client, ensure_city,
    fetch_estat_population, build_areas_from_population, upsert_areas,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

PREF_CODES   = ["31", "32", "33", "34", "35", "36", "37", "38", "39"]
CITY_NAME    = "中国・四国"
CITY_NAME_EN = "chugoku_shikoku"
CENTER_LAT   = 34.2
CENTER_LNG   = 133.2
ZOOM_LEVEL   = 7


def main() -> None:
    log.info("=" * 60)
    log.info(f"中国・四国データ更新 開始: {datetime.now().isoformat()}")

    api_key = os.getenv("ESTAT_API_KEY", "")
    if not api_key:
        log.error("ESTAT_API_KEY が未設定です")
        sys.exit(1)

    pop_data = fetch_estat_population(api_key, PREF_CODES)
    if not pop_data:
        log.error("人口データが取得できませんでした")
        sys.exit(1)

    areas = build_areas_from_population(pop_data)
    log.info(f"対象市区町村: {len(areas)} 件")

    sb = get_supabase_client()
    city_id = ensure_city(sb, CITY_NAME, CITY_NAME_EN, CENTER_LAT, CENTER_LNG, ZOOM_LEVEL)
    upsert_areas(sb, city_id, areas)

    log.info(f"完了: {datetime.now().isoformat()}")
    log.info("=" * 60)


if __name__ == "__main__":
    main()

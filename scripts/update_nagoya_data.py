#!/usr/bin/env python3
"""愛知県（名古屋）人口データ更新スクリプト (e-Stat 住民基本台帳)"""

from __future__ import annotations
import os, sys, logging
from datetime import datetime
from _common import (
    get_supabase_client, ensure_city,
    fetch_estat_population, build_areas_from_population, upsert_areas,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

PREF_CODES   = ["23"]
CITY_NAME    = "愛知"
CITY_NAME_EN = "aichi"
CENTER_LAT   = 35.1802
CENTER_LNG   = 136.9066
ZOOM_LEVEL   = 9


def main() -> None:
    log.info("=" * 60)
    log.info(f"愛知県データ更新 開始: {datetime.now().isoformat()}")

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

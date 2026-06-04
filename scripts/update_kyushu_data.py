#!/usr/bin/env python3
"""九州・沖縄 人口データ更新スクリプト (e-Stat 住民基本台帳)

対象都道府県: 福岡(40), 佐賀(41), 長崎(42), 熊本(43), 大分(44), 宮崎(45), 沖縄(47)
Note: 鹿児島(46) は kagoshima タブで管理
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

PREF_CODES   = ["40", "41", "42", "43", "44", "45", "47"]
CITY_NAME    = "九州・沖縄"
CITY_NAME_EN = "kyushu"
CENTER_LAT   = 32.5
CENTER_LNG   = 130.8
ZOOM_LEVEL   = 7


def main() -> None:
    log.info("=" * 60)
    log.info(f"九州・沖縄データ更新 開始: {datetime.now().isoformat()}")

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

#!/usr/bin/env python3
"""
Fetch municipality-level population data from 国勢調査 2020 (e-Stat)
and populate per-prefecture city/area entries in Supabase.

Dataset: 国勢調査 2020, statsDataId=0003454498
Columns stored:
  transaction_count  = 人口（2020年）
  population_delta   = 0.0 (no multi-year comparison available)
  avg_price_level    = 0.0 (population change count placeholder)
"""

from __future__ import annotations
import os, sys, time, logging
from datetime import datetime
from dotenv import load_dotenv
import requests
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    datefmt='%H:%M:%S',
)
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
ESTAT_BASE   = "https://api.e-stat.go.jp/rest/3.0/app/json"
STATS_DATA_ID = "0003454498"  # 国勢調査 2020 市区町村別人口
BATCH_SIZE   = 80   # area codes per API call
SLEEP_SECS   = 0.4  # politeness delay between calls

# Prefectures: (estat_code, name_jp, name_en, lat, lng, zoom)
# name_en must MATCH regions.ts PrefInfo.name_en values
PREFECTURES = [
    ("01","北海道",  "hokkaido",  43.06,141.35, 7),
    ("02","青森",    "aomori",    40.82,140.74, 9),
    ("03","岩手",    "iwate",     39.70,141.15, 8),
    ("04","宮城",    "sendai",    38.27,140.87, 9),   # existing as 'sendai'
    ("05","秋田",    "akita",     39.72,140.10, 9),
    ("06","山形",    "yamagata",  38.24,140.36, 9),
    ("07","福島",    "fukushima", 37.75,140.47, 9),
    ("08","茨城",    "ibaraki",   36.34,140.45, 9),
    ("09","栃木",    "tochigi",   36.57,139.88, 9),
    ("10","群馬",    "gunma",     36.39,139.06, 9),
    ("11","埼玉",    "saitama",   35.86,139.65,10),
    ("12","千葉",    "chiba",     35.61,140.12, 9),
    ("13","東京",    "tokyo",     35.69,139.69,10),
    ("14","神奈川",  "kanagawa",  35.45,139.64,10),
    ("15","新潟",    "niigata",   37.90,139.02, 9),
    ("16","富山",    "toyama",    36.70,137.21, 9),
    ("17","石川",    "ishikawa",  36.59,136.63, 9),
    ("18","福井",    "fukui",     36.06,136.22, 9),
    ("19","山梨",    "yamanashi", 35.66,138.57, 9),
    ("20","長野",    "nagano",    36.65,138.18, 8),
    ("21","岐阜",    "gifu",      35.39,136.72, 9),
    ("22","静岡",    "shizuoka",  34.98,138.38, 9),
    ("23","愛知",    "aichi",     35.18,136.91, 9),   # SKIP – sufficient data
    ("24","三重",    "mie",       34.73,136.51, 9),
    ("25","滋賀",    "shiga",     35.00,135.87, 9),
    ("26","京都",    "kyoto",     35.02,135.76,10),
    ("27","大阪",    "osaka",     34.69,135.50,10),
    ("28","兵庫",    "hyogo",     34.69,135.18, 9),
    ("29","奈良",    "nara",      34.69,135.83,10),
    ("30","和歌山",  "wakayama",  34.23,135.17, 9),
    ("31","鳥取",    "tottori",   35.50,134.24, 9),
    ("32","島根",    "shimane",   35.47,133.05, 9),
    ("33","岡山",    "okayama",   34.66,133.93, 9),
    ("34","広島",    "hiroshima", 34.40,132.46, 9),
    ("35","山口",    "yamaguchi", 34.19,131.47, 9),
    ("36","徳島",    "tokushima", 34.07,134.55, 9),
    ("37","香川",    "kagawa",    34.34,134.04,10),
    ("38","愛媛",    "ehime",     33.84,132.77, 9),
    ("39","高知",    "kochi",     33.56,133.53, 9),
    ("40","福岡",    "fukuoka",   33.59,130.42,10),
    ("41","佐賀",    "saga",      33.25,130.30,10),
    ("42","長崎",    "nagasaki",  32.75,129.88, 9),
    ("43","熊本",    "kumamoto",  32.79,130.74, 9),
    ("44","大分",    "oita",      33.24,131.61, 9),
    ("45","宮崎",    "miyazaki",  31.91,131.42, 9),
    ("46","鹿児島",  "kagoshima", 31.60,130.56,10),   # SKIP – sufficient data
    ("47","沖縄",    "okinawa",   26.21,127.68,10),
]

# Prefectures to skip (already have sufficient area data)
SKIP_NAME_EN = {"aichi", "kagoshima", "sendai"}


# ── e-Stat helpers ────────────────────────────────────────────────────────────

def get_all_area_codes(api_key: str) -> dict[str, str]:
    """Fetch the complete area code → name map (one call, limit=1)."""
    resp = requests.get(f"{ESTAT_BASE}/getStatsData", params={
        "appId": api_key, "statsDataId": STATS_DATA_ID, "limit": 1,
    }, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    class_obj = (
        data.get("GET_STATS_DATA", {})
            .get("STATISTICAL_DATA", {})
            .get("CLASS_INF", {})
            .get("CLASS_OBJ", [])
    )
    if isinstance(class_obj, dict):
        class_obj = [class_obj]

    area_map: dict[str, str] = {}
    for obj in class_obj:
        if obj.get("@id") == "area":
            classes = obj.get("CLASS", [])
            if isinstance(classes, dict):
                classes = [classes]
            for c in classes:
                area_map[c.get("@code", "")] = c.get("@name", "")
    log.info(f"Loaded {len(area_map)} area codes from e-Stat")
    return area_map


def is_municipality(code: str, name: str) -> bool:
    """
    Return True if this area code represents a municipality we want to include.
    Rules:
    - Exclude prefecture totals (last 3 digits "000")
    - Include cities (市), towns (町), villages (村)
    - Include Tokyo special wards (千代田区 etc. – no city prefix)
    - Exclude city wards of designated cities (大阪市北区 – name contains 市 and ends with 区)
    """
    if len(code) != 5:
        return False
    if code[2:] == "000":  # prefecture total
        return False
    if name.endswith("市") or name.endswith("町") or name.endswith("村"):
        return True
    if name.endswith("区"):
        # If name has "市" before "区" → it's a city ward (exclude)
        # If no "市" → it's a Tokyo special ward or similar (include)
        return "市" not in name
    return False


def fetch_population_batch(
    api_key: str, codes: list[str]
) -> dict[str, int]:
    """Fetch 2020 total population for the given area codes."""
    if not codes:
        return {}
    for attempt in range(3):
        try:
            resp = requests.get(f"{ESTAT_BASE}/getStatsData", params={
                "appId":       api_key,
                "statsDataId": STATS_DATA_ID,
                "cdArea":      ",".join(codes),
                "cdCat01":     "0",    # 総数 (all genders)
                "cdCat02":     "00",   # 総数 (all ages)
                "cdCat03":     "0",    # 常住地による人口
                "limit":       10_000,
            }, timeout=60)
            resp.raise_for_status()
            data = resp.json()
            values = (
                data.get("GET_STATS_DATA", {})
                    .get("STATISTICAL_DATA", {})
                    .get("DATA_INF", {})
                    .get("VALUE", [])
            )
            if isinstance(values, dict):
                values = [values]
            result: dict[str, int] = {}
            for v in values:
                try:
                    result[v.get("@area", "")] = int(
                        str(v.get("$", "0")).replace(",", "")
                    )
                except (ValueError, TypeError):
                    pass
            return result
        except Exception as e:
            log.warning(f"  batch attempt {attempt+1}/3 failed: {e}")
            time.sleep(2)
    return {}


def fetch_prefecture_population(
    api_key: str, pref_code: str, area_map: dict[str, str]
) -> list[dict]:
    """Return area records for all municipalities in a prefecture."""
    muni_codes = [
        code for code, name in area_map.items()
        if code.startswith(pref_code) and is_municipality(code, name)
    ]
    if not muni_codes:
        log.warning(f"  No municipality codes for pref {pref_code}")
        return []

    log.info(f"  {len(muni_codes)} municipalities to fetch")
    pop_map: dict[str, int] = {}
    for i in range(0, len(muni_codes), BATCH_SIZE):
        batch = muni_codes[i:i + BATCH_SIZE]
        batch_pop = fetch_population_batch(api_key, batch)
        pop_map.update(batch_pop)
        time.sleep(SLEEP_SECS)

    areas = []
    for code in muni_codes:
        name = area_map.get(code, "")
        pop = pop_map.get(code, 0)
        if name and pop > 0:
            areas.append({
                "name":               name,
                "population_current": pop,
                "population_change":  0.0,
                "population_delta":   0.0,
            })
    log.info(f"  → {len(areas)} areas with population data")
    return areas


# ── Supabase helpers ──────────────────────────────────────────────────────────

def get_sb():
    url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        raise ValueError("Supabase credentials missing")
    return create_client(url, key)


def ensure_city(sb, name: str, name_en: str, lat: float, lng: float, zoom: int) -> str:
    """Return city id, creating it if needed."""
    res = sb.table("cities").select("id").eq("name_en", name_en).execute()
    if res.data:
        return res.data[0]["id"]
    ins = sb.table("cities").insert({
        "name": name, "name_en": name_en,
        "center_lat": lat, "center_lng": lng, "zoom_level": zoom,
    }).execute()
    cid = ins.data[0]["id"]
    log.info(f"  Created city: {name} ({name_en}) id={cid}")
    return cid


def count_areas(sb, city_id: str) -> int:
    res = sb.table("areas").select("id").eq("city_id", city_id).execute()
    return len(res.data)


def upsert_areas(sb, city_id: str, areas: list[dict]) -> tuple[int, int]:
    inserted = updated = 0
    for a in areas:
        row = {
            "transaction_count": int(a["population_current"]),
            "avg_price_level":   float(a["population_change"]),
            "population_delta":  float(a["population_delta"]),
        }
        existing = (
            sb.table("areas")
              .select("id")
              .eq("city_id", city_id)
              .eq("name", a["name"])
              .execute()
        )
        if existing.data:
            sb.table("areas").update({
                **row, "updated_at": datetime.utcnow().isoformat(),
            }).eq("id", existing.data[0]["id"]).execute()
            updated += 1
        else:
            sb.table("areas").insert({
                "city_id": city_id, "name": a["name"], **row,
            }).execute()
            inserted += 1
    return inserted, updated


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    api_key = os.getenv("ESTAT_API_KEY", "")
    if not api_key:
        log.error("ESTAT_API_KEY not set")
        sys.exit(1)

    sb = get_sb()

    log.info("Fetching full area code map from e-Stat (one call)...")
    area_map = get_all_area_codes(api_key)

    total = len(PREFECTURES)
    success_count = 0
    skip_count = 0
    fail_count = 0

    for idx, (code, name_jp, name_en, lat, lng, zoom) in enumerate(PREFECTURES, 1):
        print(f"\n[{idx:02d}/{total}] {name_jp} ({name_en}, code={code})")

        # Skip list
        if name_en in SKIP_NAME_EN:
            print(f"  ⏭  Skipping – already has sufficient data")
            skip_count += 1
            continue

        try:
            # Ensure city entry exists
            city_id = ensure_city(sb, name_jp, name_en, lat, lng, zoom)

            # Check if already populated
            existing = count_areas(sb, city_id)
            if existing >= 5:
                print(f"  ⏭  Already has {existing} areas – skipping")
                skip_count += 1
                continue

            # Fetch from e-Stat
            areas = fetch_prefecture_population(api_key, code, area_map)
            if not areas:
                print(f"  ⚠  No data returned from e-Stat")
                fail_count += 1
                continue

            # Upsert to Supabase
            ins, upd = upsert_areas(sb, city_id, areas)
            print(f"  ✅ inserted={ins} updated={upd} total={ins+upd} municipalities")
            success_count += 1

        except Exception as e:
            log.error(f"  ❌ Error: {e}")
            fail_count += 1
            continue

    print(f"\n{'='*60}")
    print(f"Done: {success_count} success / {skip_count} skipped / {fail_count} failed")
    print(f"{'='*60}")

    # Final verification
    print("\nFinal area counts by city:")
    res = sb.table("cities").select("name,name_en").execute()
    for c in sorted(res.data, key=lambda x: x["name_en"]):
        cnt = sb.table("areas").select("id").eq(
            "city_id",
            sb.table("cities").select("id").eq("name_en", c["name_en"]).execute().data[0]["id"]
            if sb.table("cities").select("id").eq("name_en", c["name_en"]).execute().data else None
        ).execute() if False else None
        # Just print counts
        city_res = sb.table("cities").select("id").eq("name_en", c["name_en"]).execute()
        if city_res.data:
            area_cnt = sb.table("areas").select("id").eq("city_id", city_res.data[0]["id"]).execute()
            print(f"  {c['name']} ({c['name_en']}): {len(area_cnt.data)}")


if __name__ == "__main__":
    main()

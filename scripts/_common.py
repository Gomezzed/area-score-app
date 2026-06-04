"""
Shared utilities for all prefecture/region data update scripts.

Column mapping in `areas` table:
  transaction_count  → 人口（最新）  [integer]
  avg_price_level    → 人口増減数     [float, positive or negative]
  population_delta   → 人口増減率(%)  [float]
"""

from __future__ import annotations

import os
import sys
import time
import logging
from datetime import datetime
from collections import defaultdict

import requests
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env.local'))

ESTAT_BASE      = "https://api.e-stat.go.jp/rest/3.0/app/json"
REQUEST_TIMEOUT = 30
ESTAT_TIMEOUT   = 60
RETRY_WAIT      = 2

log = logging.getLogger(__name__)


# ── Supabase ──────────────────────────────────────────────────

def get_supabase_client() -> Client:
    url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not key:
        log.warning("SUPABASE_SERVICE_KEY 未設定 → ANON_KEY で試みます")
        key = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        raise ValueError("SUPABASE_URL と SUPABASE_SERVICE_KEY を設定してください")
    return create_client(url, key)


def ensure_city(sb: Client, name: str, name_en: str,
                center_lat: float, center_lng: float, zoom_level: int = 8) -> str:
    """Return city id, inserting the row if it doesn't exist."""
    res = sb.table("cities").select("id").eq("name_en", name_en).execute()
    if res.data:
        return res.data[0]["id"]
    ins = sb.table("cities").insert({
        "name": name, "name_en": name_en,
        "center_lat": center_lat, "center_lng": center_lng,
        "zoom_level": zoom_level,
    }).execute()
    city_id = ins.data[0]["id"]
    log.info(f"都市を新規作成: {name} ({name_en}) id={city_id}")
    return city_id


def upsert_areas(sb: Client, city_id: str, areas: list[dict]) -> None:
    """Upsert population-based area records.

    Each dict must have keys:
      name, population_current (int), population_change (float), population_delta (float)
    """
    inserted = updated = 0
    for a in areas:
        row_data = {
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
                **row_data,
                "updated_at": datetime.utcnow().isoformat(),
            }).eq("id", existing.data[0]["id"]).execute()
            updated += 1
        else:
            sb.table("areas").insert({
                "city_id": city_id,
                "name": a["name"],
                **row_data,
            }).execute()
            inserted += 1

    log.info(f"Supabase upsert 完了: 新規 {inserted} / 更新 {updated}")


# ── e-Stat 人口 API ───────────────────────────────────────────

def _search_estat_population_id(api_key: str) -> str | None:
    url = f"{ESTAT_BASE}/getStatsList"
    params = {
        "appId":      api_key,
        "searchWord": "住民基本台帳 市区町村 人口",
        "statsCode":  "00200241",
        "limit":      10,
    }
    try:
        resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        tables = (
            data.get("GET_STATS_LIST", {})
                .get("DATALIST_INF", {})
                .get("TABLE_INF", [])
        )
        if isinstance(tables, dict):
            tables = [tables]
        for tbl in tables:
            title = tbl.get("TITLE", {})
            title_str = title.get("$", "") if isinstance(title, dict) else str(title)
            if "市区町村" in title_str or "人口" in title_str:
                stats_id = tbl.get("@id", "")
                log.info(f"e-Stat 統計ID: {stats_id} / {title_str}")
                return stats_id
    except Exception as e:
        log.error(f"e-Stat getStatsList エラー: {e}")
    return None


def fetch_estat_population(api_key: str, pref_codes: list[str]) -> dict[str, list[int]]:
    """Fetch municipal population for given prefecture codes.

    Returns { "市区町村名": [current_pop, prev_pop], ... }
    """
    stats_id = _search_estat_population_id(api_key)
    if not stats_id:
        log.warning("e-Stat: statsDataId 不明 → 空データで続行")
        return {}

    # Query each prefecture code
    all_results: dict[str, list[int]] = {}
    for pref_code in pref_codes:
        url = f"{ESTAT_BASE}/getStatsData"
        params = {
            "appId":       api_key,
            "statsDataId": stats_id,
            "cdArea":      f"{pref_code}000",
            "limit":       100_000,
        }
        try:
            log.info(f"e-Stat 取得中: pref={pref_code}")
            resp = requests.get(url, params=params, timeout=ESTAT_TIMEOUT)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            log.error(f"e-Stat pref={pref_code} エラー: {e}")
            continue

        stat_data = (
            data.get("GET_STATS_DATA", {})
                .get("STATISTICAL_DATA", {})
        )
        class_obj = stat_data.get("CLASS_INF", {}).get("CLASS_OBJ", [])
        if isinstance(class_obj, dict):
            class_obj = [class_obj]

        area_map: dict[str, str] = {}
        time_codes: list[str] = []
        for obj in class_obj:
            if obj.get("@id") == "area":
                for cls in (obj.get("CLASS", []) or []):
                    if isinstance(cls, dict):
                        area_map[cls.get("@code", "")] = cls.get("@name", "")
            if obj.get("@id") == "time":
                for cls in (obj.get("CLASS", []) or []):
                    if isinstance(cls, dict):
                        time_codes.append(cls.get("@code", ""))

        time_codes.sort(reverse=True)
        latest_two = time_codes[:2]

        values = stat_data.get("DATA_INF", {}).get("VALUE", [])
        if isinstance(values, dict):
            values = [values]

        pop_by_area: dict[str, dict[str, int]] = defaultdict(dict)
        for v in values:
            area_code = v.get("@area", "")
            time_code = v.get("@time", "")
            if time_code not in latest_two:
                continue
            try:
                population = int(str(v.get("$", "0")).replace(",", ""))
            except ValueError:
                continue
            muni_name = area_map.get(area_code, "")
            if muni_name:
                pop_by_area[muni_name][time_code] = population

        for name, times in pop_by_area.items():
            sorted_vals = [times[t] for t in latest_two if t in times]
            if len(sorted_vals) == 2:
                all_results[name] = sorted_vals

        time.sleep(0.5)  # rate limit

    log.info(f"e-Stat 合計: {len(all_results)} 市区町村")
    return all_results


def build_areas_from_population(pop_data: dict[str, list[int]]) -> list[dict]:
    """Convert raw population data into area records."""
    areas = []
    for name, pops in pop_data.items():
        current, prev = pops[0], pops[1]
        change = current - prev
        rate = round((change / prev) * 100, 2) if prev > 0 else 0.0
        areas.append({
            "name":               name,
            "population_current": current,
            "population_change":  float(change),
            "population_delta":   rate,
        })
    return areas

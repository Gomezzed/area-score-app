#!/usr/bin/env python3
"""
REINFOLIB XPT002 official land-price ETL for public.market_metrics.

Collects official land price points, aggregates them into municipality x year x
use-category median prices, and writes them as value_type='confirmed'. Use
--dry-run to inspect planned rows without DB writes.
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import re
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from statistics import median
from typing import Any

import requests
from dotenv import load_dotenv
from supabase import Client, create_client


load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env.local"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

EX_API_BASE = "https://www.reinfolib.mlit.go.jp/ex-api/external"
XPT002_URL = f"{EX_API_BASE}/XPT002"

REQUEST_TIMEOUT = 60
MAX_RETRIES = 3
REQUEST_SLEEP = 1.0
CHUNK_SIZE = 500
DEFAULT_ZOOM = 13
PRICE_CLASSIFICATION_OFFICIAL = 0
ON_CONFLICT = "muni_code,metric_type,value_type,property_type,year,quarter"

PREF_NAMES = {
    "28": "兵庫県",
    "35": "山口県",
    "46": "鹿児島県",
}


@dataclass(frozen=True)
class BBox:
    name: str
    west: float
    south: float
    east: float
    north: float


PREF_BBOXES: dict[str, tuple[BBox, ...]] = {
    "28": (
        BBox("hyogo_all", 134.20, 34.15, 135.60, 35.75),
    ),
    "35": (
        BBox("yamaguchi_all", 130.70, 33.65, 132.55, 34.85),
    ),
    "46": (
        BBox("kagoshima_mainland", 129.55, 30.95, 131.25, 32.35),
        BBox("kagoshima_koshiki", 129.35, 31.55, 129.95, 32.15),
        BBox("kagoshima_tanegashima_yakushima", 130.30, 30.15, 131.15, 30.95),
        BBox("kagoshima_tokara", 128.85, 28.95, 130.10, 30.15),
        BBox("kagoshima_amami_yoron", 128.35, 27.00, 130.10, 28.55),
    ),
}


class ApiShapeError(RuntimeError):
    def __init__(self, message: str, sample: Any):
        super().__init__(message)
        self.sample = sample


def env_required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} が未設定です。export 後に再実行してください。")
    return value


def get_supabase() -> Client:
    url = env_required("SUPABASE_URL")
    key = env_required("SUPABASE_SERVICE_ROLE_KEY")
    return create_client(url, key)


def lonlat_to_tile(lng: float, lat: float, zoom: int) -> tuple[int, int]:
    lat = max(min(lat, 85.05112878), -85.05112878)
    n = 2 ** zoom
    x = int((lng + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat)
    y = int((1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n)
    return max(0, min(n - 1, x)), max(0, min(n - 1, y))


def bbox_tiles(bbox: BBox, zoom: int) -> set[tuple[int, int]]:
    x_min, y_south = lonlat_to_tile(bbox.west, bbox.south, zoom)
    x_max, y_north = lonlat_to_tile(bbox.east, bbox.north, zoom)
    y_min = min(y_north, y_south)
    y_max = max(y_north, y_south)
    return {
        (x, y)
        for x in range(min(x_min, x_max), max(x_min, x_max) + 1)
        for y in range(y_min, y_max + 1)
    }


def tiles_for_pref(pref_code: str, zoom: int) -> list[tuple[int, int]]:
    tiles: set[tuple[int, int]] = set()
    for bbox in PREF_BBOXES[pref_code]:
        tiles.update(bbox_tiles(bbox, zoom))
    return sorted(tiles, key=lambda tile: (tile[1], tile[0]))


def sample_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)[:4000]


def api_get_json(
    session: requests.Session,
    params: dict[str, Any],
    api_key: str,
    skip_counts: Counter[str],
) -> Any | None:
    headers = {
        "Ocp-Apim-Subscription-Key": api_key,
        "Accept-Encoding": "gzip",
    }
    for attempt in range(1, MAX_RETRIES + 1):
        time.sleep(REQUEST_SLEEP)
        try:
            resp = session.get(XPT002_URL, params=params, headers=headers, timeout=REQUEST_TIMEOUT)
            if resp.status_code == 404:
                skip_counts["api_404_empty"] += 1
                return None
            if resp.status_code == 429:
                skip_counts["api_429"] += 1
                wait = resp.headers.get("Retry-After", "")
                sleep_for = float(wait) if wait.replace(".", "", 1).isdigit() else attempt * 5.0
                log.warning("429 rate limited: params=%s sleep=%.1fs", params, sleep_for)
                time.sleep(sleep_for)
                continue
            if 500 <= resp.status_code < 600:
                skip_counts["api_5xx_retry"] += 1
                if attempt == MAX_RETRIES:
                    log.warning("5xx after retries: status=%s params=%s", resp.status_code, params)
                    return None
                time.sleep(attempt * 2.0)
                continue
            if 400 <= resp.status_code < 500:
                skip_counts[f"api_{resp.status_code}"] += 1
                raise RuntimeError(
                    f"REINFOLIB XPT002 returned HTTP {resp.status_code}: "
                    f"params={params} body={resp.text[:1000]}"
                )
            resp.raise_for_status()
            return resp.json()
        except requests.Timeout:
            skip_counts["api_timeout_retry"] += 1
            if attempt == MAX_RETRIES:
                log.warning("timeout after retries: params=%s", params)
                return None
            time.sleep(attempt * 2.0)
        except requests.RequestException as exc:
            skip_counts["api_request_error_retry"] += 1
            if attempt == MAX_RETRIES:
                log.warning("request failed after retries: params=%s error=%s", params, exc)
                return None
            time.sleep(attempt * 2.0)
        except ValueError as exc:
            skip_counts["api_json_error"] += 1
            raise RuntimeError(f"REINFOLIB XPT002 JSON parse failed: params={params}") from exc
    return None


def extract_features(payload: Any) -> list[dict[str, Any]]:
    if payload is None:
        return []
    if isinstance(payload, dict):
        features = payload.get("features")
        if isinstance(features, list):
            return [feature for feature in features if isinstance(feature, dict)]
    if isinstance(payload, list):
        return [feature for feature in payload if isinstance(feature, dict)]
    raise ApiShapeError("XPT002 returned an unexpected payload shape", payload)


def load_known_municipality_codes(sb: Client) -> set[str]:
    codes: set[str] = set()
    offset = 0
    while True:
        res = (
            sb.table("municipalities")
            .select("city_code")
            .range(offset, offset + 999)
            .execute()
        )
        rows = res.data or []
        for row in rows:
            code = str(row.get("city_code") or "").strip()
            if len(code) == 5 and code.isdigit():
                codes.add(code)
        if len(rows) < 1000:
            break
        offset += 1000
    return codes


def parse_price(value: Any) -> int | None:
    if value in (None, "", "-", "*"):
        return None
    text = str(value).strip()
    text = re.sub(r"\(.*?\)", "", text)
    text = (
        text.replace(",", "")
        .replace("円", "")
        .replace("㎡", "")
        .replace("m^2", "")
        .replace("m2", "")
        .strip()
    )
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    if not match:
        return None
    try:
        return int(round(float(match.group(0))))
    except ValueError:
        return None


def normalize_point_id(value: Any) -> str | None:
    if value in (None, ""):
        return None
    return str(value).strip()


def process_features(
    features: list[dict[str, Any]],
    year: int,
    pref_code: str,
    known_codes: set[str],
    seen_point_ids: set[str],
    skip_counts: Counter[str],
) -> dict[tuple[str, int, str], list[int]]:
    buckets: dict[tuple[str, int, str], list[int]] = defaultdict(list)
    for feature in features:
        props = feature.get("properties")
        if not isinstance(props, dict):
            skip_counts["missing_properties"] += 1
            continue

        point_id = normalize_point_id(props.get("point_id"))
        if point_id and point_id in seen_point_ids:
            skip_counts["duplicate_point_id"] += 1
            continue
        if point_id:
            seen_point_ids.add(point_id)

        if props.get("pause_flag") not in (None, "", 0, "0"):
            skip_counts["pause_flag_skipped"] += 1
            continue
        if props.get("land_price_type") not in (None, "", PRICE_CLASSIFICATION_OFFICIAL, "0"):
            skip_counts["non_official_land_price_type_skipped"] += 1
            continue

        city_code = str(props.get("city_code") or "").strip()
        if city_code not in known_codes or not city_code.startswith(pref_code):
            skip_counts["fk_guard_skipped"] += 1
            continue

        use_category = str(props.get("use_category_name_ja") or "").strip()
        if not use_category:
            skip_counts["missing_use_category"] += 1
            continue

        price = parse_price(props.get("u_current_years_price_ja"))
        if price is None:
            skip_counts["price_parse_failed"] += 1
            continue

        buckets[(city_code, year, use_category)].append(price)
    return buckets


def fetch_tile_features(
    session: requests.Session,
    api_key: str,
    zoom: int,
    x: int,
    y: int,
    year: int,
    skip_counts: Counter[str],
) -> list[dict[str, Any]]:
    payload = api_get_json(
        session,
        {
            "response_format": "geojson",
            "z": zoom,
            "x": x,
            "y": y,
            "year": year,
            "priceClassification": PRICE_CLASSIFICATION_OFFICIAL,
        },
        api_key,
        skip_counts,
    )
    return extract_features(payload)


def merge_buckets(
    dest: dict[tuple[str, int, str], list[int]],
    src: dict[tuple[str, int, str], list[int]],
) -> None:
    for key, values in src.items():
        dest[key].extend(values)


def build_rows(
    buckets: dict[tuple[str, int, str], list[int]],
    fetched_at: str,
    zoom: int,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for (city_code, year, use_category), prices in sorted(buckets.items()):
        rows.append(
            {
                "muni_code": city_code,
                "metric_type": "official_land_price",
                "value_type": "confirmed",
                "property_type": use_category,
                "year": year,
                "quarter": None,
                "value": int(round(median(prices))),
                "unit": "円/㎡",
                "sample_count": len(prices),
                "source": "REINFOLIB XPT002",
                "source_detail": {
                    "aggregation": "median",
                    "price_classification": PRICE_CLASSIFICATION_OFFICIAL,
                    "zoom": zoom,
                    "fetched_at": fetched_at,
                },
            }
        )
    return rows


def upsert_market_metrics(sb: Client, rows: list[dict[str, Any]]) -> int:
    written = 0
    for i in range(0, len(rows), CHUNK_SIZE):
        chunk = rows[i:i + CHUNK_SIZE]
        sb.table("market_metrics").upsert(chunk, on_conflict=ON_CONFLICT).execute()
        written += len(chunk)
        log.info("upserted market_metrics chunk: %s rows (total=%s)", len(chunk), written)
    return written


def print_dry_run_summary(
    rows: list[dict[str, Any]],
    pref_counts: Counter[str],
    type_counts: Counter[str],
    skip_counts: Counter[str],
    tile_stats: dict[str, Any],
    started_at: float,
) -> None:
    duration = time.monotonic() - started_at
    print("")
    print("=== DRY-RUN SUMMARY ===")
    print(f"投入予定行数: {len(rows)}")
    print("都道府県別の投入予定行数")
    for pref_code in sorted(pref_counts):
        print(f"  {pref_code} {PREF_NAMES.get(pref_code, '')}: {pref_counts[pref_code]}")
    if not pref_counts:
        print("  (none)")

    print("use_category_name_ja 内訳")
    for use_category, count in type_counts.most_common():
        print(f"  {use_category}: {count}")
    if not type_counts:
        print("  (none)")

    print("サンプル10行")
    for row in rows[:10]:
        print(json.dumps(row, ensure_ascii=False, sort_keys=True))
    if not rows:
        print("  (none)")

    print("スキップ件数")
    for key in sorted(skip_counts):
        print(f"  {key}: {skip_counts[key]}")
    if not skip_counts:
        print("  (none)")

    print("タイル統計")
    print(json.dumps(tile_stats, ensure_ascii=False, sort_keys=True))
    print(f"実行時間: {duration:.1f}秒")
    print("=== END DRY-RUN SUMMARY ===")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch REINFOLIB XPT002 into market_metrics.")
    parser.add_argument("--pref", action="append", required=True,
                        help="都道府県コード2桁。対応: 28, 35, 46。複数指定可。")
    parser.add_argument("--from-year", type=int, default=2022)
    parser.add_argument("--to-year", type=int, default=2026)
    parser.add_argument("--dry-run", action="store_true",
                        help="DB書込みなしで投入予定行を出力する。")
    parser.add_argument("--zoom", type=int, default=DEFAULT_ZOOM)
    return parser.parse_args()


def main() -> int:
    started_at = time.monotonic()
    args = parse_args()
    pref_codes = [str(p).zfill(2) for p in args.pref]
    invalid_prefs = [p for p in pref_codes if p not in PREF_BBOXES]
    if invalid_prefs:
        log.error("invalid --pref: %s", ", ".join(invalid_prefs))
        return 2
    if args.from_year > args.to_year:
        log.error("--from-year must be <= --to-year")
        return 2
    if args.zoom < DEFAULT_ZOOM:
        log.error("--zoom must be >= %s for XPT002", DEFAULT_ZOOM)
        return 2

    try:
        api_key = env_required("REINFOLIB_API_KEY")
        sb = get_supabase()
    except RuntimeError as exc:
        log.error("%s", exc)
        return 2

    fetched_at = datetime.now(timezone.utc).isoformat()
    years = list(range(args.from_year, args.to_year + 1))
    discovery_year = args.to_year
    past_years = [year for year in years if year != discovery_year]

    skip_counts: Counter[str] = Counter()
    pref_counts: Counter[str] = Counter()
    type_counts: Counter[str] = Counter()
    all_rows: list[dict[str, Any]] = []
    tile_stats: dict[str, Any] = {
        "zoom": args.zoom,
        "discovery_year": discovery_year,
        "prefs": {},
        "total_requests": 0,
        "empty_tiles": 0,
    }

    log.info("official land price ETL start%s", " [DRY-RUN]" if args.dry_run else "")
    log.info("prefs=%s years=%s-%s zoom=%s", ",".join(pref_codes), args.from_year, args.to_year, args.zoom)
    known_codes = load_known_municipality_codes(sb)
    log.info("loaded municipalities: %s city codes", len(known_codes))

    session = requests.Session()
    global_buckets: dict[tuple[str, int, str], list[int]] = defaultdict(list)

    for pref_code in pref_codes:
        pref_name = PREF_NAMES[pref_code]
        all_tiles = tiles_for_pref(pref_code, args.zoom)
        pref_tile_stats = {
            "bbox_tile_count": len(all_tiles),
            "nonempty_tiles": 0,
            "requests": 0,
            "empty_tiles": 0,
        }
        tile_stats["prefs"][pref_code] = pref_tile_stats
        log.info("[%s %s] discovery start: year=%s tiles=%s", pref_code, pref_name, discovery_year, len(all_tiles))

        nonempty_tiles: list[tuple[int, int]] = []
        seen_point_ids_by_year: dict[int, set[str]] = defaultdict(set)
        pref_buckets: dict[tuple[str, int, str], list[int]] = defaultdict(list)

        for idx, (x, y) in enumerate(all_tiles, start=1):
            features = fetch_tile_features(
                session, api_key, args.zoom, x, y, discovery_year, skip_counts
            )
            tile_stats["total_requests"] += 1
            pref_tile_stats["requests"] += 1
            if features:
                nonempty_tiles.append((x, y))
                part = process_features(
                    features,
                    discovery_year,
                    pref_code,
                    known_codes,
                    seen_point_ids_by_year[discovery_year],
                    skip_counts,
                )
                merge_buckets(pref_buckets, part)
            else:
                skip_counts["empty_tile"] += 1
                tile_stats["empty_tiles"] += 1
                pref_tile_stats["empty_tiles"] += 1

            if idx == 1 or idx % 100 == 0 or idx == len(all_tiles):
                log.info(
                    "[%s %s] discovery progress %s/%s nonempty=%s",
                    pref_code, pref_name, idx, len(all_tiles), len(nonempty_tiles),
                )

        pref_tile_stats["nonempty_tiles"] = len(nonempty_tiles)
        log.info("[%s %s] discovery complete: nonempty_tiles=%s", pref_code, pref_name, len(nonempty_tiles))

        for year in past_years:
            log.info("[%s %s] historical fetch start: year=%s tiles=%s", pref_code, pref_name, year, len(nonempty_tiles))
            for idx, (x, y) in enumerate(nonempty_tiles, start=1):
                features = fetch_tile_features(session, api_key, args.zoom, x, y, year, skip_counts)
                tile_stats["total_requests"] += 1
                pref_tile_stats["requests"] += 1
                if features:
                    part = process_features(
                        features,
                        year,
                        pref_code,
                        known_codes,
                        seen_point_ids_by_year[year],
                        skip_counts,
                    )
                    merge_buckets(pref_buckets, part)
                else:
                    skip_counts["empty_tile"] += 1
                    tile_stats["empty_tiles"] += 1
                    pref_tile_stats["empty_tiles"] += 1

                if idx == 1 or idx % 100 == 0 or idx == len(nonempty_tiles):
                    log.info(
                        "[%s %s] year=%s progress %s/%s",
                        pref_code, pref_name, year, idx, len(nonempty_tiles),
                    )

        merge_buckets(global_buckets, pref_buckets)
        pref_rows = build_rows(pref_buckets, fetched_at, args.zoom)
        pref_counts[pref_code] += len(pref_rows)
        type_counts.update(row["property_type"] for row in pref_rows)
        all_rows.extend(pref_rows)
        log.info("[%s %s] planned_rows=%s", pref_code, pref_name, len(pref_rows))

    all_rows = build_rows(global_buckets, fetched_at, args.zoom)
    pref_counts = Counter(row["muni_code"][:2] for row in all_rows)
    type_counts = Counter(row["property_type"] for row in all_rows)

    if args.dry_run:
        print_dry_run_summary(all_rows, pref_counts, type_counts, skip_counts, tile_stats, started_at)
        log.info("dry-run complete: planned_rows=%s", len(all_rows))
        return 0

    written = upsert_market_metrics(sb, all_rows)
    duration = time.monotonic() - started_at
    log.info("ETL complete: planned_rows=%s upserted_rows=%s duration=%.1fs skips=%s",
             len(all_rows), written, duration, dict(skip_counts))
    return 0


if __name__ == "__main__":
    sys.exit(main())

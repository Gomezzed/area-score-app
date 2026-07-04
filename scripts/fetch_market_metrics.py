#!/usr/bin/env python3
"""
REINFOLIB XIT001 trade-price ETL for public.market_metrics.

Collects official REINFOLIB transaction records, aggregates them into
municipality x quarter x property type median unit prices, and writes them as
value_type='reference'. Use --dry-run to inspect planned rows without DB writes.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from collections import Counter, defaultdict
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
XIT001_URL = f"{EX_API_BASE}/XIT001"
XIT002_URL = f"{EX_API_BASE}/XIT002"

REQUEST_TIMEOUT = 60
MAX_RETRIES = 3
REQUEST_SLEEP = 1.0
CHUNK_SIZE = 500
MIN_SAMPLE_COUNT = 3
QUARTERS = (1, 2, 3, 4)

ON_CONFLICT = "muni_code,metric_type,value_type,property_type,year,quarter"

PREF_NAMES = {
    "01": "北海道", "02": "青森県", "03": "岩手県", "04": "宮城県", "05": "秋田県",
    "06": "山形県", "07": "福島県", "08": "茨城県", "09": "栃木県", "10": "群馬県",
    "11": "埼玉県", "12": "千葉県", "13": "東京都", "14": "神奈川県", "15": "新潟県",
    "16": "富山県", "17": "石川県", "18": "福井県", "19": "山梨県", "20": "長野県",
    "21": "岐阜県", "22": "静岡県", "23": "愛知県", "24": "三重県", "25": "滋賀県",
    "26": "京都府", "27": "大阪府", "28": "兵庫県", "29": "奈良県", "30": "和歌山県",
    "31": "鳥取県", "32": "島根県", "33": "岡山県", "34": "広島県", "35": "山口県",
    "36": "徳島県", "37": "香川県", "38": "愛媛県", "39": "高知県", "40": "福岡県",
    "41": "佐賀県", "42": "長崎県", "43": "熊本県", "44": "大分県", "45": "宮崎県",
    "46": "鹿児島県", "47": "沖縄県",
}

CITY_CODE_KEYS = (
    "MunicipalityCode", "municipalityCode", "MunicipalityCD", "municipalityCd",
    "CityCode", "cityCode", "city_code", "city", "Code", "code",
)
CITY_NAME_KEYS = (
    "MunicipalityName", "municipalityName", "CityName", "cityName",
    "Name", "name",
)


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


def clean_number(value: Any) -> float | None:
    if value in (None, "", "-", "*"):
        return None
    text = str(value).strip()
    if not text:
        return None
    text = (
        text.replace(",", "")
        .replace("円", "")
        .replace("㎡", "")
        .replace("m^2", "")
        .replace("m2", "")
    )
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def normalize_city_code(value: Any, pref_code: str) -> str | None:
    if value in (None, ""):
        return None
    text = str(value).strip()
    match = re.search(r"\d{4,6}", text)
    if not match:
        return None
    code = match.group(0)
    if len(code) == 4 and pref_code in {f"{n:02d}" for n in range(1, 10)}:
        code = code.zfill(5)
    if len(code) == 6 and code.endswith("0"):
        code = code[:5]
    if len(code) == 5 and code.isdigit():
        return code
    return None


def extract_rows(payload: Any) -> list[Any]:
    if payload is None:
        return []
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("data", "Data", "result", "results", "items", "features"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
    return []


def row_payload(row: Any) -> dict[str, Any]:
    if isinstance(row, dict) and isinstance(row.get("properties"), dict):
        return row["properties"]
    return row if isinstance(row, dict) else {}


def sample_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)[:4000]


def api_get_json(
    session: requests.Session,
    url: str,
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
            resp = session.get(url, params=params, headers=headers, timeout=REQUEST_TIMEOUT)
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
                    f"REINFOLIB API returned HTTP {resp.status_code}: "
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
            raise RuntimeError(f"REINFOLIB API JSON parse failed: params={params}") from exc
    return None


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


def extract_city_name(row: dict[str, Any]) -> str:
    for key in CITY_NAME_KEYS:
        value = row.get(key)
        if value not in (None, ""):
            return str(value).strip()
    return ""


def extract_city_code(row: dict[str, Any], pref_code: str) -> str | None:
    for key in CITY_CODE_KEYS:
        code = normalize_city_code(row.get(key), pref_code)
        if code:
            return code
    for key, value in row.items():
        key_text = str(key).lower()
        if any(token in key_text for token in ("municipality", "city", "code")):
            code = normalize_city_code(value, pref_code)
            if code:
                return code
    return None


def fetch_cities_for_pref(
    session: requests.Session,
    pref_code: str,
    api_key: str,
    skip_counts: Counter[str],
) -> list[dict[str, str]]:
    payload = api_get_json(session, XIT002_URL, {"area": pref_code}, api_key, skip_counts)
    rows = extract_rows(payload)
    if not rows:
        raise ApiShapeError(f"XIT002 returned no parseable rows for pref={pref_code}", payload)

    cities: dict[str, dict[str, str]] = {}
    bad_rows = 0
    first_bad: Any | None = None
    for raw in rows:
        row = row_payload(raw)
        code = extract_city_code(row, pref_code)
        if not code or not code.startswith(pref_code):
            bad_rows += 1
            first_bad = first_bad if first_bad is not None else raw
            continue
        cities[code] = {"city_code": code, "name": extract_city_name(row)}

    if not cities:
        raise ApiShapeError(
            f"XIT002 city-code parsing failed for pref={pref_code}; bad_rows={bad_rows}",
            first_bad if first_bad is not None else rows[0],
        )
    if bad_rows:
        skip_counts["xit002_unparseable_rows"] += bad_rows
    return sorted(cities.values(), key=lambda c: c["city_code"])


def fetch_xit001_records(
    session: requests.Session,
    city_code: str,
    year: int,
    quarter: int,
    api_key: str,
    skip_counts: Counter[str],
) -> list[dict[str, Any]]:
    payload = api_get_json(
        session,
        XIT001_URL,
        {"year": year, "quarter": quarter, "city": city_code},
        api_key,
        skip_counts,
    )
    if payload is None:
        return []
    rows = extract_rows(payload)
    if not rows:
        if isinstance(payload, dict) and payload.get("status") not in (None, "OK"):
            log.debug("XIT001 empty/non-OK: city=%s year=%s q=%s payload=%s",
                      city_code, year, quarter, sample_json(payload))
        return []
    out: list[dict[str, Any]] = []
    for raw in rows:
        row = row_payload(raw)
        if row:
            out.append(row)
    return out


def aggregate_records(
    records: list[dict[str, Any]],
    fallback_city_code: str,
    year: int,
    quarter: int,
    pref_code: str,
    skip_counts: Counter[str],
) -> dict[tuple[str, str, int, int], list[float]]:
    buckets: dict[tuple[str, str, int, int], list[float]] = defaultdict(list)
    for record in records:
        city_code = (
            normalize_city_code(record.get("MunicipalityCode"), pref_code)
            or normalize_city_code(record.get("municipalityCode"), pref_code)
            or fallback_city_code
        )
        property_type = str(record.get("Type") or "").strip()
        if not property_type:
            skip_counts["missing_type"] += 1
            continue
        trade_price = clean_number(record.get("TradePrice"))
        area = clean_number(record.get("Area"))
        if trade_price is None:
            skip_counts["invalid_trade_price"] += 1
            continue
        if area is None or area <= 0:
            skip_counts["invalid_area"] += 1
            continue
        buckets[(city_code, property_type, year, quarter)].append(trade_price / area)
    return buckets


def build_rows_from_buckets(
    buckets: dict[tuple[str, str, int, int], list[float]],
    known_codes: set[str],
    fetched_at: str,
    skip_counts: Counter[str],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for (city_code, property_type, year, quarter), values in sorted(buckets.items()):
        if city_code not in known_codes:
            skip_counts["fk_record_group_skipped"] += 1
            continue
        sample_count = len(values)
        if sample_count < MIN_SAMPLE_COUNT:
            skip_counts["sample_count_lt_3_group_skipped"] += 1
            continue
        rows.append(
            {
                "muni_code": city_code,
                "metric_type": "trade_price",
                "value_type": "reference",
                "property_type": property_type,
                "year": year,
                "quarter": quarter,
                "value": int(round(median(values))),
                "unit": "円/㎡",
                "sample_count": sample_count,
                "source": "REINFOLIB XIT001",
                "source_detail": {
                    "aggregation": "median_unit_price",
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
) -> None:
    print("")
    print("=== DRY-RUN SUMMARY ===")
    print("都道府県別の投入予定行数")
    for pref_code in sorted(pref_counts):
        print(f"  {pref_code} {PREF_NAMES.get(pref_code, '')}: {pref_counts[pref_code]}")
    if not pref_counts:
        print("  (none)")

    print("物件種別の内訳")
    for property_type, count in type_counts.most_common():
        print(f"  {property_type}: {count}")
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
    print("=== END DRY-RUN SUMMARY ===")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch REINFOLIB XIT001 into market_metrics.")
    parser.add_argument("--pref", action="append", required=True,
                        help="都道府県コード2桁。複数指定可。")
    parser.add_argument("--from-year", type=int, default=2022)
    parser.add_argument("--to-year", type=int, default=2026)
    parser.add_argument("--dry-run", action="store_true",
                        help="DB書込みなしで投入予定行を出力する。")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    pref_codes = [str(p).zfill(2) for p in args.pref]
    invalid_prefs = [p for p in pref_codes if p not in PREF_NAMES]
    if invalid_prefs:
        log.error("invalid --pref: %s", ", ".join(invalid_prefs))
        return 2
    if args.from_year > args.to_year:
        log.error("--from-year must be <= --to-year")
        return 2

    try:
        api_key = env_required("REINFOLIB_API_KEY")
        sb = get_supabase()
    except RuntimeError as exc:
        log.error("%s", exc)
        return 2

    fetched_at = datetime.now(timezone.utc).isoformat()
    years = range(args.from_year, args.to_year + 1)
    skip_counts: Counter[str] = Counter()
    pref_counts: Counter[str] = Counter()
    type_counts: Counter[str] = Counter()
    all_rows: list[dict[str, Any]] = []

    log.info("market_metrics ETL start%s", " [DRY-RUN]" if args.dry_run else "")
    log.info("prefs=%s years=%s-%s", ",".join(pref_codes), args.from_year, args.to_year)
    known_codes = load_known_municipality_codes(sb)
    log.info("loaded municipalities: %s city codes", len(known_codes))

    session = requests.Session()
    for pref_code in pref_codes:
        pref_name = PREF_NAMES.get(pref_code, "")
        log.info("[%s %s] XIT002 city list fetch", pref_code, pref_name)
        try:
            cities = fetch_cities_for_pref(session, pref_code, api_key, skip_counts)
        except ApiShapeError as exc:
            log.error("%s", exc)
            log.error("unexpected response sample: %s", sample_json(exc.sample))
            return 1
        log.info("[%s %s] XIT002 cities=%s", pref_code, pref_name, len(cities))

        valid_cities = []
        for city in cities:
            if city["city_code"] not in known_codes:
                skip_counts["fk_city_skipped"] += 1
                log.info("[%s] skip city not in municipalities: %s %s",
                         pref_code, city["city_code"], city.get("name") or "")
                continue
            valid_cities.append(city)

        for idx, city in enumerate(valid_cities, start=1):
            city_code = city["city_code"]
            city_name = city.get("name") or ""
            city_buckets: dict[tuple[str, str, int, int], list[float]] = defaultdict(list)
            raw_records = 0
            for year in years:
                for quarter in QUARTERS:
                    records = fetch_xit001_records(
                        session, city_code, year, quarter, api_key, skip_counts
                    )
                    raw_records += len(records)
                    part = aggregate_records(
                        records, city_code, year, quarter, pref_code, skip_counts
                    )
                    for key, values in part.items():
                        city_buckets[key].extend(values)

            city_rows = build_rows_from_buckets(
                city_buckets, known_codes, fetched_at, skip_counts
            )
            all_rows.extend(city_rows)
            pref_counts[pref_code] += len(city_rows)
            type_counts.update(row["property_type"] for row in city_rows)
            log.info(
                "[%s %s] %s/%s city=%s %s records=%s planned_rows=%s",
                pref_code, pref_name, idx, len(valid_cities),
                city_code, city_name, raw_records, len(city_rows),
            )

    if args.dry_run:
        print_dry_run_summary(all_rows, pref_counts, type_counts, skip_counts)
        log.info("dry-run complete: planned_rows=%s", len(all_rows))
        return 0

    written = upsert_market_metrics(sb, all_rows)
    log.info("ETL complete: planned_rows=%s upserted_rows=%s skips=%s",
             len(all_rows), written, dict(skip_counts))
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
国土交通省 不動産取引価格情報 データ収集スクリプト

取得対象: 中古マンション等, 2018〜2024年, 全47都道府県
出典: https://www.land.mlit.go.jp/webland/
"""

from __future__ import annotations

import os
import sys
import time
import logging
from datetime import datetime

import requests
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env.local'))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

MLIT_BASE = "https://www.land.mlit.go.jp/webland/api/TradeListSearch"
YEARS     = list(range(2018, 2025))
QUARTERS  = [1, 2, 3, 4]
PREFS     = [f"{i:02d}" for i in range(1, 48) if i != 46]  # 46=鹿児島は含める
PREFS.insert(-1, "46")  # add 46 back for kagoshima
PREFS     = [f"{i:02d}" for i in range(1, 48)]
REQUEST_TIMEOUT = 30
RETRY_WAIT      = 2
BATCH_SIZE      = 200  # upsert batch size


def safe_float(value, default: float = 0.0) -> float:
    try:
        return float(str(value).replace(",", "").replace("円", "").strip())
    except (ValueError, TypeError):
        return default


def get_supabase_client() -> Client:
    url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not key:
        key = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        raise ValueError("SUPABASE_URL と SUPABASE_SERVICE_KEY を設定してください")
    return create_client(url, key)


def fetch_quarter(pref_code: str, year: int, quarter: int) -> list[dict]:
    """Fetch 中古マンション等 transactions for one prefecture/quarter."""
    q_str = f"{year}{quarter}"
    params = {
        "from":       q_str,
        "to":         q_str,
        "prefecture": pref_code,
        "type":       "3",  # 中古マンション等
    }
    for attempt in range(3):
        try:
            resp = requests.get(MLIT_BASE, params=params, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            data = resp.json()
            return data.get("data", [])
        except requests.RequestException as e:
            log.warning(f"  リトライ {attempt+1}/3 pref={pref_code} {q_str}: {e}")
            time.sleep(RETRY_WAIT)
    log.error(f"  失敗: pref={pref_code} {q_str}")
    return []


def records_to_rows(records: list[dict], pref_code: str, year: int, quarter: int) -> list[dict]:
    rows = []
    for r in records:
        city_name = r.get("Municipality", "").strip()
        if not city_name:
            continue
        unit_price_raw = safe_float(r.get("UnitPrice", 0))
        total_price_raw = safe_float(r.get("TradePrice", 0))
        area_raw = safe_float(r.get("Area", 0))

        rows.append({
            "prefecture_code": pref_code,
            "city_name":       city_name,
            "year":            year,
            "quarter":         quarter,
            "price_per_sqm":   unit_price_raw if unit_price_raw > 0 else None,
            "total_price":     round(total_price_raw / 10_000, 1) if total_price_raw > 0 else None,
            "area_sqm":        area_raw if area_raw > 0 else None,
            "property_type":   r.get("Type", "中古マンション等"),
        })
    return rows


def upsert_batch(sb: Client, rows: list[dict]) -> None:
    if not rows:
        return
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        try:
            sb.table("real_estate_transactions").insert(batch).execute()
        except Exception as e:
            log.warning(f"  バッチ insert エラー: {e}")


def already_fetched(sb: Client, pref_code: str, year: int, quarter: int) -> bool:
    """Skip if data for this prefecture/year/quarter already exists."""
    try:
        res = (
            sb.table("real_estate_transactions")
              .select("id")
              .eq("prefecture_code", pref_code)
              .eq("year", year)
              .eq("quarter", quarter)
              .limit(1)
              .execute()
        )
        return bool(res.data)
    except Exception:
        return False


def main() -> None:
    log.info("=" * 60)
    log.info(f"不動産取引データ収集 開始: {datetime.now().isoformat()}")
    log.info(f"対象: {len(PREFS)} 都道府県 × {len(YEARS)} 年 × 4 四半期")

    sb = get_supabase_client()

    total_rows = 0
    for pref in PREFS:
        for year in YEARS:
            for q in QUARTERS:
                if already_fetched(sb, pref, year, q):
                    log.info(f"  スキップ (既存): pref={pref} {year}Q{q}")
                    continue

                log.info(f"  取得中: pref={pref} {year}Q{q}")
                records = fetch_quarter(pref, year, q)
                if not records:
                    continue

                rows = records_to_rows(records, pref, year, q)
                if rows:
                    upsert_batch(sb, rows)
                    total_rows += len(rows)
                    log.info(f"    → {len(rows)} 件 insert")

                time.sleep(0.3)  # rate limit

    log.info(f"完了: 合計 {total_rows} 件")
    log.info("=" * 60)


if __name__ == "__main__":
    main()

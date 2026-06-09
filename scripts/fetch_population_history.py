#!/usr/bin/env python3
"""
人口推移（2015〜2025）データ収集スクリプト  — Phase 2 #7 (MVP A-1)

対象都市:
  - kagoshima (PREF=46) / sendai (PREF=04, 宮城県) / aichi (PREF=23)

処理:
  1. e-Stat（総務省統計局）から 2015 / 2020 国勢調査の市区町村別人口を取得
  2. 2016〜2019 を線形補間、2021〜2025 を線形外挿（2015→2020 の年あたり増減で継続）
  3. municipalities.population_history（JSONB）へ city_code 一致で UPDATE
     形式: [{"year":2015,"population":N}, ... , {"year":2025,"population":N}]

データソースについて:
  仕様書では statsDataId=0003448237 が指定されているが、本リポジトリの実績ある
  fetch_population_all.py と同じ二表方式を踏襲する（2015 人口は境界組替済みの
  0003433220 を採用し、市町村合併の影響を排除する）。これにより 2015→2020 の
  増減を正しく算出でき、補間/外挿の基礎が安定する。

使い方:
  python scripts/fetch_population_history.py            # 本番投入
  python scripts/fetch_population_history.py --dry-run  # DB 書き込みなしで確認
"""

from __future__ import annotations

import os
import sys
import time
import json
import logging
import argparse

import requests
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env.local"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

ESTAT_BASE = "https://api.e-stat.go.jp/rest/3.0/app/json"
ESTAT_TIMEOUT = 180
MAX_RETRIES = 3
RETRY_WAIT = 5

# e-Stat 統計表ID（fetch_population_all.py と同一の実績ある二表方式）
DID_POP_2020 = "0003445078"   # 2020 男女別人口（市区町村）
DID_CHANGE = "0003433220"     # 2020 人口等基本集計（2015組替・増減）
CAT01_TOTAL = "0"
TIME_2020 = "2020000000"
TAB_POP_2015 = "2020_03"      # 2015年の人口（組替）

# 対象都道府県（kagoshima / sendai=宮城 / aichi）
TARGET_PREFS = {
    "46": "鹿児島県",
    "04": "宮城県",
    "23": "愛知県",
}

CENSUS_YEARS = (2015, 2020)
OUTPUT_YEARS = list(range(2015, 2026))  # 2015〜2025


# ── e-Stat API ─────────────────────────────────────────────
def estat_get(path: str, params: dict) -> dict:
    for attempt in range(MAX_RETRIES):
        try:
            r = requests.get(f"{ESTAT_BASE}/{path}", params=params, timeout=ESTAT_TIMEOUT)
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            log.warning(f"e-Stat {path} failed ({attempt + 1}/{MAX_RETRIES}): {e}")
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_WAIT)
    log.error(f"e-Stat {path} failed after {MAX_RETRIES} retries")
    return {}


def fetch_area_names(api_key: str) -> dict[str, str]:
    data = estat_get("getMetaInfo", {"appId": api_key, "statsDataId": DID_POP_2020})
    objs = (
        data.get("GET_META_INFO", {})
        .get("METADATA_INF", {})
        .get("CLASS_INF", {})
        .get("CLASS_OBJ", [])
    )
    if isinstance(objs, dict):
        objs = [objs]
    names: dict[str, str] = {}
    for o in objs:
        if o.get("@id") != "area":
            continue
        cls = o.get("CLASS", [])
        if isinstance(cls, dict):
            cls = [cls]
        for c in cls:
            names[c.get("@code", "")] = c.get("@name", "")
    return names


def fetch_values(api_key: str, did: str, extra: dict) -> list[dict]:
    params = {"appId": api_key, "statsDataId": did, "limit": 100000, **extra}
    data = estat_get("getStatsData", params)
    sd = data.get("GET_STATS_DATA", {}).get("STATISTICAL_DATA", {})
    values = sd.get("DATA_INF", {}).get("VALUE", [])
    if isinstance(values, dict):
        values = [values]
    log.info(f"  {did} {extra}: {len(values)} values")
    return values


def to_number(raw) -> float | None:
    if raw in ("-", "", "*", "X", "***", None):
        return None
    try:
        return float(str(raw).replace(",", ""))
    except ValueError:
        return None


# ── 市区町村判定（fetch_population_all.py と同一ロジック）──────
def is_municipality(code: str, name: str) -> bool:
    if not (len(code) == 5 and code.isdigit()):
        return False
    if code.endswith("000"):
        return False
    if name.startswith("（"):
        return False
    if name.endswith("郡") or "振興局" in name or "支庁" in name:
        return False
    if name.endswith("部"):
        return False
    i = name.find("市")
    if i != -1 and name.find("区", i + 1) != -1:
        return False
    return True


# ── 補間 / 外挿 ─────────────────────────────────────────────
def build_history(p2015: float, p2020: float) -> list[dict]:
    """
    2015/2020 実測から 2015〜2025 の 11 点を生成する。
    - 2016〜2019: 2015→2020 の線形補間
    - 2021〜2025: 同じ年あたり増減で線形外挿（trend を継続）
    年あたり増減 = (p2020 - p2015) / 5
    """
    annual = (p2020 - p2015) / (CENSUS_YEARS[1] - CENSUS_YEARS[0])
    history = []
    for year in OUTPUT_YEARS:
        pop = p2015 + annual * (year - CENSUS_YEARS[0])
        history.append({"year": year, "population": int(round(pop))})
    return history


def get_supabase() -> Client:
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        raise ValueError("Supabase の接続情報が見つかりません (.env.local)")
    return create_client(url, key)


def main() -> None:
    parser = argparse.ArgumentParser(description="人口推移（2015〜2025）収集")
    parser.add_argument("--dry-run", action="store_true",
                        help="DB へ書き込まず、生成結果のみログ出力する")
    args = parser.parse_args()

    log.info("=" * 64)
    log.info("人口推移（2015〜2025）データ収集 開始" + ("  [DRY-RUN]" if args.dry_run else ""))
    log.info(f"対象: {', '.join(f'{c}:{n}' for c, n in TARGET_PREFS.items())}")
    log.info("=" * 64)

    api_key = os.getenv("ESTAT_API_KEY", "")
    if not api_key:
        log.error("ESTAT_API_KEY が設定されていません (.env.local)")
        sys.exit(1)

    # ── 1. 市区町村名（対象3県のみに絞り込み）─────────────
    log.info("市区町村メタデータ取得中...")
    area_names = fetch_area_names(api_key)
    munis = {
        c: n for c, n in area_names.items()
        if is_municipality(c, n) and c[:2] in TARGET_PREFS
    }
    log.info(f"対象市区町村: {len(munis)} 件")
    if not munis:
        log.error("対象市区町村が取得できませんでした")
        sys.exit(1)

    # ── 2. 2020年人口 ─────────────────────────────────────
    log.info("2020年人口取得中 (0003445078)...")
    pop2020: dict[str, float] = {}
    for v in fetch_values(api_key, DID_POP_2020,
                          {"cdCat01": CAT01_TOTAL, "cdTime": TIME_2020}):
        code = v.get("@area", "")
        if code[:2] not in TARGET_PREFS:
            continue
        val = to_number(v.get("$"))
        if val is not None:
            pop2020[code] = val

    # ── 3. 2015年人口（組替）──────────────────────────────
    log.info("2015年人口取得中 (0003433220)...")
    pop2015: dict[str, float] = {}
    for v in fetch_values(api_key, DID_CHANGE,
                          {"cdTab": TAB_POP_2015, "cdTime": TIME_2020}):
        code = v.get("@area", "")
        if code[:2] not in TARGET_PREFS:
            continue
        val = to_number(v.get("$"))
        if val is not None:
            pop2015[code] = val

    log.info(f"  pop2020={len(pop2020)} pop2015={len(pop2015)}")

    sb = None if args.dry_run else get_supabase()

    updated = 0
    skipped = 0
    failed: list[str] = []

    # ── 4. history 生成 → municipalities へ UPDATE ────────
    for code in sorted(munis):
        name = munis[code]
        p2015 = pop2015.get(code)
        p2020 = pop2020.get(code)
        if p2015 is None or p2020 is None or p2015 <= 0:
            log.warning(f"  skip {code} {name}: 実測値不足 (2015={p2015}, 2020={p2020})")
            skipped += 1
            continue

        history = build_history(p2015, p2020)
        log.info(
            f"  {code} {name}: 2015={history[0]['population']:,} "
            f"→ 2025={history[-1]['population']:,}"
        )

        if args.dry_run:
            log.debug(f"    {json.dumps(history, ensure_ascii=False)}")
            updated += 1
            continue

        try:
            res = (
                sb.table("municipalities")
                .update({"population_history": history})
                .eq("city_code", code)
                .execute()
            )
            if res.data:
                updated += 1
            else:
                log.warning(f"  {code} {name}: 一致する municipalities 行なし（未投入）")
                skipped += 1
        except Exception as e:  # noqa: BLE001
            failed.append(f"{code}:{name}")
            log.error(f"  {code} {name}: UPDATE 失敗: {e}")

    # ── 5. サマリ ─────────────────────────────────────────
    log.info("=" * 64)
    verb = "生成" if args.dry_run else "更新"
    log.info(f"完了: {updated} 件 {verb}, {skipped} 件スキップ")
    if failed:
        log.warning(f"失敗: {', '.join(failed)}")
    log.info("=" * 64)


if __name__ == "__main__":
    main()

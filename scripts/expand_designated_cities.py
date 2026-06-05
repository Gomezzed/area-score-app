#!/usr/bin/env python3
"""
政令指定都市 行政区（区）展開スクリプト（国勢調査 2015 / 2020）

目的:
  既存の市区町村データは政令指定都市を「市」単位の1エントリで保持している
  （例: 名古屋市 = 23100）。本スクリプトは20の政令指定都市について、その
  行政区（例: 名古屋市西区 = 23104）を e-Stat から取得し、独立した
  municipalities + population_stats レコードとして upsert する。

データソース（総務省統計局 e-Stat / getStatsData API）:
  - 0003445078  令和2年(2020)国勢調査  男女別人口（市区町村）   → 2020年 人口
  - 0003433220  令和2年(2020)国勢調査  人口等基本集計（増減）   → 2015年 人口(組替)・
                                                                  世帯数・5年間の人口増減数/増減率

  ※ fetch_population_all.py は is_municipality() で政令市の行政区を除外している。
    本スクリプトはその逆で、行政区のみを対象に取り込む。市本体エントリ
    （名古屋市 等）はそのまま残す（UI 側で市→区のドリルダウンに使用）。

区の親子関係:
  区名は必ず「<市名><区名区>」（例: 横浜市鶴見区, 川崎市川崎区）の形を取る。
  名称の「市」接頭辞が20政令市のいずれかに一致する行を区として採用する。
  （東京23特別区は「<区名>区」で「市」接頭辞を持たないため対象外。）

環境変数:
  ESTAT_API_KEY                  ... e-Stat アプリケーションID（必須）
  NEXT_PUBLIC_SUPABASE_URL       ... SupabaseプロジェクトURL
  SUPABASE_SERVICE_KEY           ... サービスロールキー（無ければ ANON を使用）
  NEXT_PUBLIC_SUPABASE_ANON_KEY  ... 匿名キー（RLS無効のため書込可）
"""

from __future__ import annotations

import os
import sys
import time
import logging
from collections import defaultdict

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

DID_POP_2020 = "0003445078"   # 2020 男女別人口（市区町村）
DID_CHANGE = "0003433220"     # 2020 人口等基本集計（2015組替・増減）

CAT01_TOTAL = "0"
TIME_2020 = "2020000000"

TAB_POP_2015 = "2020_03"         # 2015年の人口（組替）
TAB_HOUSEHOLDS_2020 = "2020_13"  # 世帯数（2020）
TAB_HOUSEHOLDS_2015 = "2020_15"  # 2015年の世帯数（組替）

# 展開対象の20政令指定都市（名称）
DESIGNATED_CITIES = {
    "札幌市", "仙台市", "さいたま市", "千葉市", "横浜市", "川崎市", "相模原市",
    "新潟市", "静岡市", "浜松市", "名古屋市", "京都市", "大阪市", "堺市",
    "神戸市", "岡山市", "広島市", "北九州市", "福岡市", "熊本市",
}


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
    """0003445078 のメタ情報から {市区町村コード: 名称} を取得"""
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
    result = sd.get("RESULT_INF", {})
    values = sd.get("DATA_INF", {}).get("VALUE", [])
    if isinstance(values, dict):
        values = [values]
    log.info(f"  {did} {extra}: {len(values)} values (total={result.get('TOTAL_NUMBER')})")
    return values


def to_number(raw) -> float | None:
    if raw in ("-", "", "*", "X", "***", None):
        return None
    try:
        return float(str(raw).replace(",", ""))
    except ValueError:
        return None


def ward_parent_city(name: str) -> str | None:
    """区名（例 '名古屋市西区'）→ 親政令市名（'名古屋市'）。区でなければ None。"""
    if not name.endswith("区"):
        return None
    i = name.find("市")
    if i == -1:
        return None
    city = name[: i + 1]
    return city if city in DESIGNATED_CITIES else None


def get_supabase() -> Client:
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        raise ValueError("Supabase の接続情報が見つかりません (.env.local)")
    return create_client(url, key)


def main() -> None:
    log.info("=" * 64)
    log.info("政令指定都市 行政区展開 開始（国勢調査 2015/2020）")
    log.info("=" * 64)

    api_key = os.getenv("ESTAT_API_KEY", "")
    if not api_key:
        log.error("ESTAT_API_KEY が設定されていません (.env.local)")
        sys.exit(1)

    # ── 1. 区コードの抽出 ─────────────────────────────────
    log.info("市区町村メタデータ取得中...")
    area_names = fetch_area_names(api_key)
    wards: dict[str, str] = {}        # ward_code -> ward_name
    parent_of: dict[str, str] = {}    # ward_code -> parent city name
    for code, name in area_names.items():
        if not (len(code) == 5 and code.isdigit()):
            continue
        parent = ward_parent_city(name)
        if parent is not None:
            wards[code] = name
            parent_of[code] = parent

    found_cities = sorted({parent_of[c] for c in wards})
    log.info(f"対象 行政区: {len(wards)} 区 / {len(found_cities)} 政令市")
    missing = DESIGNATED_CITIES - set(found_cities)
    if missing:
        log.warning(f"区が見つからなかった政令市: {', '.join(sorted(missing))}")
    if not wards:
        log.error("行政区が取得できませんでした")
        sys.exit(1)

    # ── 2. 2020年人口（区のみ抽出）────────────────────────
    log.info("2020年人口取得中 (0003445078)...")
    pop2020: dict[str, float] = {}
    for v in fetch_values(api_key, DID_POP_2020,
                          {"cdCat01": CAT01_TOTAL, "cdTime": TIME_2020}):
        code = v.get("@area", "")
        if code in wards:
            val = to_number(v.get("$"))
            if val is not None:
                pop2020[code] = val

    # ── 3. 2015年人口・世帯数（区のみ抽出）────────────────
    log.info("2015年人口・世帯数取得中 (0003433220)...")
    pop2015: dict[str, float] = {}
    hh2020: dict[str, float] = {}
    hh2015: dict[str, float] = {}
    tab_map = {TAB_POP_2015: pop2015, TAB_HOUSEHOLDS_2020: hh2020, TAB_HOUSEHOLDS_2015: hh2015}
    for v in fetch_values(api_key, DID_CHANGE,
                          {"cdTab": ",".join(tab_map.keys()), "cdTime": TIME_2020}):
        code = v.get("@area", "")
        if code not in wards:
            continue
        target = tab_map.get(v.get("@tab", ""))
        if target is None:
            continue
        val = to_number(v.get("$"))
        if val is not None:
            target[code] = val

    log.info(f"  pop2020={len(pop2020)} pop2015={len(pop2015)} "
             f"hh2020={len(hh2020)} hh2015={len(hh2015)}")

    # ── 4. 政令市別に upsert ──────────────────────────────
    by_city: dict[str, list[str]] = defaultdict(list)
    for code in wards:
        by_city[parent_of[code]].append(code)

    sb = get_supabase()
    total_wards = 0
    total_stats = 0

    for city in sorted(by_city):
        codes = sorted(by_city[city])
        try:
            muni_rows = [
                {
                    "prefecture_code": code[:2],
                    "city_code": code,
                    "name": wards[code],
                    "lat": None,
                    "lng": None,
                }
                for code in codes
            ]
            res = (
                sb.table("municipalities")
                .upsert(muni_rows, on_conflict="city_code")
                .execute()
            )
            id_by_code = {row["city_code"]: row["id"] for row in res.data}

            stat_rows = []
            for code in codes:
                mid = id_by_code.get(code)
                if mid is None:
                    continue
                p2020 = pop2020.get(code)
                p2015 = pop2015.get(code)

                delta = delta_rate = None
                if p2020 is not None and p2015 not in (None, 0):
                    delta = int(round(p2020 - p2015))
                    delta_rate = round((p2020 - p2015) / p2015 * 100, 2)

                if p2015 is not None:
                    stat_rows.append({
                        "municipality_id": mid,
                        "year": 2015,
                        "population": int(round(p2015)),
                        "households": int(round(hh2015[code])) if code in hh2015 else None,
                        "population_delta": None,
                        "population_delta_rate": None,
                    })
                if p2020 is not None:
                    stat_rows.append({
                        "municipality_id": mid,
                        "year": 2020,
                        "population": int(round(p2020)),
                        "households": int(round(hh2020[code])) if code in hh2020 else None,
                        "population_delta": delta,
                        "population_delta_rate": delta_rate,
                    })

            if stat_rows:
                sb.table("population_stats").upsert(
                    stat_rows, on_conflict="municipality_id,year"
                ).execute()

            total_wards += len(muni_rows)
            total_stats += len(stat_rows)
            log.info(f"{city}: {len(muni_rows)} 区 / {len(stat_rows)} 統計レコード")

        except Exception as e:  # noqa: BLE001
            log.error(f"{city}: FAILED: {e}")
            continue

    log.info("=" * 64)
    log.info(f"完了: {total_wards} 行政区, {total_stats} 人口統計レコード")
    log.info("=" * 64)


if __name__ == "__main__":
    main()

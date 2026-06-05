#!/usr/bin/env python3
"""
全国 市区町村 人口データ収集スクリプト（国勢調査 2015 / 2020）

データソース（総務省統計局 e-Stat / getStatsData API）:
  - 0003445078  令和2年(2020)国勢調査  男女別人口（市区町村）   → 2020年 人口
  - 0003433220  令和2年(2020)国勢調査  人口等基本集計（増減）   → 2015年 人口(組替)・
                                                                  世帯数・5年間の人口増減数/増減率

注意:
  仕様書では 2015年センサスの statsDataId として '0003407821' が指定されているが、
  これは「住宅・土地統計」系の表であり市区町村別人口を含まない。
  そのため 2015年人口は、2020年と同一境界(2020年市区町村)に組み替えられた
  0003433220 の「2015年の人口（組替）」を採用する。これにより市町村合併による
  境界変更の影響を受けずに 2015→2020 の増減を正しく算出できる。

  人口増減数 = pop2020 - pop2015
  人口増減率 = (pop2020 - pop2015) / pop2015 * 100

市区町村の判定:
  5桁の数値コードのうち、都道府県計(末尾000)・全国(00000)・郡/振興局の集計行・
  政令市の行政区(例: 札幌市中央区)を除外する。政令市本体(例: 札幌市)と
  東京23特別区(例: 千代田区)は市区町村として残す。
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

# e-Stat 統計表ID
DID_POP_2020 = "0003445078"   # 2020 男女別人口（市区町村）
DID_CHANGE = "0003433220"     # 2020 人口等基本集計（2015組替・増減）

# 0003445078 cat01（男女）: 0=総数
CAT01_TOTAL = "0"
TIME_2020 = "2020000000"

# 0003433220 tab コード
TAB_POP_2015 = "2020_03"      # 2015年の人口（組替）
TAB_HOUSEHOLDS_2020 = "2020_13"  # 世帯数（2020）
TAB_HOUSEHOLDS_2015 = "2020_15"  # 2015年の世帯数（組替）

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
    """getStatsData → VALUE 配列を返す（全件）"""
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


# ── 市区町村判定 ───────────────────────────────────────────
def is_municipality(code: str, name: str) -> bool:
    if not (len(code) == 5 and code.isdigit()):
        return False                      # 旧市区町村(英字コード)等を除外
    if code.endswith("000"):
        return False                      # 都道府県計 / 全国
    if name.startswith("（"):
        return False                      # （旧：…）等
    if name.endswith("郡") or "振興局" in name or "支庁" in name:
        return False                      # 郡・振興局の集計行
    if name.endswith("部"):
        return False                      # 「特別区部」等の集計行（東京23区は個別に残す）
    i = name.find("市")
    if i != -1 and name.find("区", i + 1) != -1:
        return False                      # 政令市の行政区（例: 札幌市中央区）
    return True


def get_supabase() -> Client:
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        raise ValueError("Supabase の接続情報が見つかりません (.env.local)")
    return create_client(url, key)


def main() -> None:
    log.info("=" * 64)
    log.info("国勢調査 2015/2020 市区町村人口データ収集 開始")
    log.info("=" * 64)

    api_key = os.getenv("ESTAT_API_KEY", "")
    if not api_key:
        log.error("ESTAT_API_KEY が設定されていません (.env.local)")
        sys.exit(1)

    # ── 1. 市区町村名の取得・フィルタ ─────────────────────
    log.info("市区町村メタデータ取得中...")
    area_names = fetch_area_names(api_key)
    munis = {c: n for c, n in area_names.items() if is_municipality(c, n)}
    log.info(f"対象市区町村: {len(munis)} 件")
    if not munis:
        log.error("市区町村が取得できませんでした")
        sys.exit(1)

    # ── 2. 2020年人口（0003445078, 総数）─────────────────
    log.info("2020年人口取得中 (0003445078)...")
    pop2020: dict[str, float] = {}
    for v in fetch_values(api_key, DID_POP_2020,
                          {"cdCat01": CAT01_TOTAL, "cdTime": TIME_2020}):
        val = to_number(v.get("$"))
        if val is not None:
            pop2020[v.get("@area", "")] = val

    # ── 3. 2015年人口・世帯数（0003433220）────────────────
    log.info("2015年人口・世帯数取得中 (0003433220)...")
    pop2015: dict[str, float] = {}
    hh2020: dict[str, float] = {}
    hh2015: dict[str, float] = {}
    tab_map = {TAB_POP_2015: pop2015, TAB_HOUSEHOLDS_2020: hh2020, TAB_HOUSEHOLDS_2015: hh2015}
    for v in fetch_values(api_key, DID_CHANGE,
                          {"cdTab": ",".join(tab_map.keys()), "cdTime": TIME_2020}):
        tab = v.get("@tab", "")
        target = tab_map.get(tab)
        if target is None:
            continue
        val = to_number(v.get("$"))
        if val is not None:
            target[v.get("@area", "")] = val

    log.info(f"  pop2020={len(pop2020)} pop2015={len(pop2015)} "
             f"hh2020={len(hh2020)} hh2015={len(hh2015)}")

    # ── 4. 都道府県別にまとめる ───────────────────────────
    by_pref: dict[str, list[str]] = defaultdict(list)
    for code in munis:
        by_pref[code[:2]].append(code)

    sb = get_supabase()

    total_munis = 0
    total_stats = 0
    failed_prefs: list[str] = []

    # ── 5. 都道府県ごとに upsert（1件失敗しても継続）──────
    for idx, pref_code in enumerate(sorted(PREF_NAMES.keys()), start=1):
        pref_name = PREF_NAMES[pref_code]
        codes = sorted(by_pref.get(pref_code, []))
        try:
            if not codes:
                log.warning(f"Prefecture {idx:02d}/47: {pref_name} - 市区町村データなし")
                continue

            # 5-1. municipalities upsert（city_code 一意）
            muni_rows = [
                {
                    "prefecture_code": pref_code,
                    "city_code": code,
                    "name": munis[code],
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

            # 5-2. population_stats upsert（2015 / 2020 各年）
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

            total_munis += len(muni_rows)
            total_stats += len(stat_rows)
            log.info(f"Prefecture {idx:02d}/47: {pref_name} - inserted {len(muni_rows)} municipalities")

        except Exception as e:  # noqa: BLE001
            failed_prefs.append(f"{pref_code}:{pref_name}")
            log.error(f"Prefecture {idx:02d}/47: {pref_name} - FAILED: {e}")
            continue

    # ── 6. サマリ ─────────────────────────────────────────
    log.info("=" * 64)
    log.info(f"完了: {total_munis} 市区町村, {total_stats} 人口統計レコード")
    if failed_prefs:
        log.warning(f"失敗した都道府県: {', '.join(failed_prefs)}")
    else:
        log.info("全47都道府県を正常に処理しました")
    log.info("=" * 64)


if __name__ == "__main__":
    main()

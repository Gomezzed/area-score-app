#!/usr/bin/env python3
"""
九州・沖縄地方（福岡・佐賀・長崎・熊本・大分・宮崎・沖縄）
不動産・人口データ 自動更新スクリプト

取得元:
  - 国土交通省 不動産取引価格情報 API (認証不要)
  - e-Stat 住民基本台帳 API

更新先:
  - Supabase areas テーブル（九州・沖縄地方市区町村別）

注意:
  鹿児島県（code 46）は別途 kagoshima タブで管理するため除外しています。

環境変数:
  SUPABASE_URL          ... SupabaseプロジェクトURL
  SUPABASE_SERVICE_KEY  ... Supabase サービスロールキー（RLS bypass）
  ESTAT_API_KEY         ... e-Stat APIキー
"""

from __future__ import annotations

import os
import sys
import time
import logging
from datetime import date, datetime
from collections import defaultdict

import requests
from dotenv import load_dotenv
from supabase import create_client, Client

# ── 設定 ──────────────────────────────────────────────
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env.local'))

PREF_CODES    = ["40", "41", "42", "43", "44", "45", "47"]
PREF_NAME     = "九州・沖縄（福岡・佐賀・長崎・熊本・大分・宮崎・沖縄）"
CITY_NAME_EN  = "kyushu_okinawa"
SCORE_WEIGHTS = {"transaction": 0.4, "population": 0.3, "price": 0.3}

# 福岡県 全60市町村
FUKUOKA_MUNICIPALITIES = [
    "北九州市", "福岡市", "大牟田市", "久留米市", "直方市", "飯塚市", "田川市",
    "柳川市", "八女市", "筑後市", "大川市", "行橋市", "豊前市", "中間市",
    "小郡市", "筑紫野市", "春日市", "大野城市", "宗像市", "太宰府市", "古賀市",
    "福津市", "うきは市", "宮若市", "嘉麻市", "朝倉市", "みやま市", "糸島市",
    "那珂川市",
    "宇美町", "篠栗町", "志免町", "須恵町", "新宮町", "久山町", "粕屋町",
    "芦屋町", "水巻町", "岡垣町", "遠賀町",
    "小竹町", "鞍手町",
    "桂川町",
    "筑前町", "東峰村",
    "大刀洗町",
    "大木町",
    "広川町",
    "香春町", "添田町", "糸田町", "川崎町", "大任町", "赤村", "福智町",
    "苅田町", "みやこ町",
    "吉富町", "上毛町", "築上町",
]

# 佐賀県 全20市町村
SAGA_MUNICIPALITIES = [
    "佐賀市", "唐津市", "鳥栖市", "多久市", "伊万里市", "武雄市", "鹿島市",
    "小城市", "嬉野市", "神埼市",
    "吉野ヶ里町", "基山町", "上峰町", "みやき町",
    "玄海町", "有田町",
    "大町町", "江北町", "白石町",
    "太良町",
]

# 長崎県 全21市町村
NAGASAKI_MUNICIPALITIES = [
    "長崎市", "佐世保市", "島原市", "諫早市", "大村市", "平戸市", "松浦市",
    "対馬市", "壱岐市", "五島市", "西海市", "雲仙市", "南島原市",
    "長与町", "時津町",
    "東彼杵町", "川棚町", "波佐見町",
    "小値賀町", "佐々町",
    "新上五島町",
]

# 熊本県 全45市町村
KUMAMOTO_MUNICIPALITIES = [
    "熊本市", "八代市", "人吉市", "荒尾市", "水俣市", "玉名市", "山鹿市",
    "菊池市", "宇土市", "上天草市", "宇城市", "阿蘇市", "天草市", "合志市",
    "美里町", "玉東町", "南関町", "長洲町", "和水町",
    "大津町", "菊陽町",
    "南小国町", "小国町", "産山村", "高森町", "西原村", "南阿蘇村",
    "御船町", "嘉島町", "益城町", "甲佐町", "山都町",
    "氷川町",
    "芦北町", "津奈木町",
    "錦町", "多良木町", "湯前町", "水上村", "相良村", "五木村", "山江村",
    "球磨村", "あさぎり町",
    "苓北町",
]

# 大分県 全18市町村
OITA_MUNICIPALITIES = [
    "大分市", "別府市", "中津市", "日田市", "佐伯市", "臼杵市", "津久見市",
    "竹田市", "豊後高田市", "杵築市", "宇佐市", "豊後大野市", "由布市", "国東市",
    "姫島村", "日出町",
    "九重町", "玖珠町",
]

# 宮崎県 全26市町村
MIYAZAKI_MUNICIPALITIES = [
    "宮崎市", "都城市", "延岡市", "日南市", "小林市", "日向市", "串間市",
    "西都市", "えびの市",
    "三股町", "高原町", "国富町", "綾町", "高鍋町", "新富町", "西米良村",
    "木城町", "川南町", "都農町",
    "門川町", "諸塚村", "椎葉村", "美郷町",
    "高千穂町", "日之影町", "五ヶ瀬町",
]

# 沖縄県 全41市町村
OKINAWA_MUNICIPALITIES = [
    "那覇市", "宜野湾市", "石垣市", "浦添市", "名護市", "糸満市", "沖縄市",
    "豊見城市", "うるま市", "宮古島市", "南城市",
    "国頭村", "大宜味村", "東村",
    "今帰仁村", "本部町",
    "恩納村", "宜野座村", "金武町",
    "伊江村",
    "読谷村", "嘉手納町", "北谷町", "北中城村", "中城村", "西原町",
    "与那原町", "南風原町",
    "渡嘉敷村", "座間味村", "粟国村", "渡名喜村", "南大東村", "北大東村",
    "伊平屋村", "伊是名村",
    "久米島町",
    "八重瀬町",
    "多良間村", "竹富町", "与那国町",
]

ALL_MUNICIPALITIES = (
    FUKUOKA_MUNICIPALITIES +
    SAGA_MUNICIPALITIES +
    NAGASAKI_MUNICIPALITIES +
    KUMAMOTO_MUNICIPALITIES +
    OITA_MUNICIPALITIES +
    MIYAZAKI_MUNICIPALITIES +
    OKINAWA_MUNICIPALITIES
)

MLIT_BASE       = "https://www.land.mlit.go.jp/webland/api/TradeListSearch"
ESTAT_BASE      = "https://api.e-stat.go.jp/rest/3.0/app/json"
FETCH_QUARTERS  = 4
REQUEST_TIMEOUT = 30
ESTAT_TIMEOUT   = 60
RETRY_WAIT      = 2

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


# ── ユーティリティ ──────────────────────────────────────
def recent_quarters(n: int = 4) -> list[str]:
    quarters = []
    today = date.today()
    year, month = today.year, today.month
    q = (month - 1) // 3 + 1
    for _ in range(n):
        quarters.append(f"{year}{q}")
        q -= 1
        if q == 0:
            q, year = 4, year - 1
    return quarters


def safe_float(value, default: float = 0.0) -> float:
    try:
        return float(str(value).replace(",", "").replace("円", "").strip())
    except (ValueError, TypeError):
        return default


def normalize_score(raw: float, min_val: float, max_val: float) -> float:
    if max_val == min_val:
        return 50.0
    return max(0.0, min(100.0, (raw - min_val) / (max_val - min_val) * 100))


# ── MLIT 不動産取引 API ──────────────────────────────────
def fetch_mlit_transactions(pref_code: str, quarters: list[str]) -> list[dict]:
    all_data: list[dict] = []
    for q in quarters:
        params = {"from": q, "to": q, "prefecture": pref_code}
        for attempt in range(3):
            try:
                log.info(f"MLIT API 取得中: pref={pref_code} quarter={q}")
                resp = requests.get(MLIT_BASE, params=params, timeout=REQUEST_TIMEOUT)
                resp.raise_for_status()
                records = resp.json().get("data", [])
                log.info(f"  → {len(records)} 件取得")
                all_data.extend(records)
                break
            except requests.RequestException as e:
                log.warning(f"  → リトライ {attempt+1}/3: {e}")
                time.sleep(RETRY_WAIT)
        else:
            log.error(f"  → pref={pref_code} quarter={q} の取得に失敗しました")
    return all_data


def aggregate_transactions(records: list[dict]) -> dict[str, dict]:
    agg: dict[str, dict] = defaultdict(lambda: {"count": 0, "prices": []})
    for r in records:
        name = r.get("Municipality", "").strip()
        if not name:
            continue
        unit_price = safe_float(r.get("UnitPrice", 0))
        if unit_price > 0:
            agg[name]["prices"].append(unit_price / 10_000)
        agg[name]["count"] += 1
    result: dict[str, dict] = {}
    for name, v in agg.items():
        result[name] = {
            "transaction_count": v["count"],
            "avg_price_level": sum(v["prices"]) / len(v["prices"]) if v["prices"] else 0.0,
        }
    log.info(f"MLIT 集計: {len(result)} 市区町村")
    return result


# ── e-Stat 人口 API ──────────────────────────────────────
def search_estat_population_id(api_key: str) -> str | None:
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
                log.info(f"e-Stat 統計ID発見: {stats_id} / {title_str}")
                return stats_id
    except Exception as e:
        log.error(f"e-Stat getStatsList エラー: {e}")
    return None


def fetch_estat_population(api_key: str, pref_code: str) -> dict[str, list[int]]:
    stats_id = search_estat_population_id(api_key)
    if not stats_id:
        log.warning("e-Stat: statsDataId が見つからないためスキップします")
        return {}
    url = f"{ESTAT_BASE}/getStatsData"
    params = {
        "appId":       api_key,
        "statsDataId": stats_id,
        "cdArea":      f"{pref_code}000",
        "limit":       100_000,
    }
    try:
        log.info(f"e-Stat データ取得中: pref={pref_code} statsDataId={stats_id}")
        resp = requests.get(url, params=params, timeout=ESTAT_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        log.error(f"e-Stat getStatsData エラー: {e}")
        return {}

    stat_data = data.get("GET_STATS_DATA", {}).get("STATISTICAL_DATA", {})
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

    result: dict[str, list[int]] = {}
    for name, times in pop_by_area.items():
        sorted_vals = [times[t] for t in latest_two if t in times]
        if len(sorted_vals) == 2:
            result[name] = sorted_vals

    log.info(f"e-Stat 人口データ: {len(result)} 市区町村")
    return result


def calc_population_delta(pop_data: dict[str, list[int]], muni_name: str) -> float:
    pops = pop_data.get(muni_name)
    if not pops or len(pops) < 2 or pops[1] == 0:
        return 0.0
    return round((pops[0] - pops[1]) / pops[1] * 100, 2)


def find_population_fuzzy(pop_data: dict[str, list[int]], muni_name: str) -> float:
    delta = calc_population_delta(pop_data, muni_name)
    if delta != 0.0:
        return delta
    for key in pop_data:
        if muni_name.startswith(key) or key.startswith(muni_name):
            return calc_population_delta(pop_data, key)
    return 0.0


# ── スコア計算 ──────────────────────────────────────────
def compute_scores(areas_raw: list[dict]) -> list[dict]:
    if not areas_raw:
        return []

    txn_vals   = [a["transaction_count"] for a in areas_raw]
    pop_vals   = [a["population_delta"]  for a in areas_raw]
    price_vals = [a["avg_price_level"]   for a in areas_raw]

    txn_min,   txn_max   = min(txn_vals),   max(txn_vals)
    pop_min,   pop_max   = min(pop_vals),   max(pop_vals)
    price_min, price_max = min(price_vals), max(price_vals)

    result = []
    for a in areas_raw:
        s_txn   = normalize_score(a["transaction_count"], txn_min, txn_max)
        s_pop   = normalize_score(a["population_delta"],  pop_min, pop_max)
        s_price = normalize_score(a["avg_price_level"],   price_min, price_max)
        score   = round(
            s_txn   * SCORE_WEIGHTS["transaction"] +
            s_pop   * SCORE_WEIGHTS["population"]  +
            s_price * SCORE_WEIGHTS["price"],
            2,
        )
        tier = "A" if score >= 70 else ("B" if score >= 40 else "C")
        result.append({**a, "score": score, "tier": tier})
    return result


# ── Supabase 更新 ──────────────────────────────────────────
def get_supabase_client() -> Client:
    url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not key:
        log.warning("SUPABASE_SERVICE_KEY が未設定です。NEXT_PUBLIC_SUPABASE_ANON_KEY で試みます")
        key = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        raise ValueError("SUPABASE_URL と SUPABASE_SERVICE_KEY を設定してください")
    return create_client(url, key)


def ensure_city(sb: Client) -> str:
    res = sb.table("cities").select("id").eq("name_en", CITY_NAME_EN).execute()
    if res.data:
        log.info(f"既存の都市を使用: {CITY_NAME_EN} / id={res.data[0]['id']}")
        return res.data[0]["id"]
    log.info(f"都市を新規作成: {CITY_NAME_EN}")
    insert_res = sb.table("cities").insert({
        "name":       "九州・沖縄",
        "name_en":    CITY_NAME_EN,
        "center_lat": 32.8,
        "center_lng": 130.7,
        "zoom_level": 7,
    }).execute()
    city_id = insert_res.data[0]["id"]
    log.info(f"都市作成完了: id={city_id}")
    return city_id


def upsert_areas(sb: Client, city_id: str, areas: list[dict]) -> None:
    inserted = updated = 0
    for a in areas:
        existing = (
            sb.table("areas")
              .select("id")
              .eq("city_id", city_id)
              .eq("name", a["name"])
              .execute()
        )
        row = {
            "transaction_count": int(a["transaction_count"]),
            "population_delta":  float(a["population_delta"]),
            "avg_price_level":   float(a["avg_price_level"]),
        }
        if existing.data:
            sb.table("areas").update({
                **row,
                "updated_at": datetime.utcnow().isoformat(),
            }).eq("id", existing.data[0]["id"]).execute()
            updated += 1
        else:
            sb.table("areas").insert({
                "city_id": city_id,
                "name":    a["name"],
                **row,
            }).execute()
            inserted += 1

    log.info(f"Supabase 更新完了: 新規 {inserted} 件 / 更新 {updated} 件")


# ── メイン ─────────────────────────────────────────────────
def main() -> None:
    log.info("=" * 60)
    log.info(f"九州・沖縄データ更新スクリプト 開始: {datetime.now().isoformat()}")
    log.info(
        f"対象: 福岡 {len(FUKUOKA_MUNICIPALITIES)} + "
        f"佐賀 {len(SAGA_MUNICIPALITIES)} + "
        f"長崎 {len(NAGASAKI_MUNICIPALITIES)} + "
        f"熊本 {len(KUMAMOTO_MUNICIPALITIES)} + "
        f"大分 {len(OITA_MUNICIPALITIES)} + "
        f"宮崎 {len(MIYAZAKI_MUNICIPALITIES)} + "
        f"沖縄 {len(OKINAWA_MUNICIPALITIES)} 市区町村"
    )
    log.info("=" * 60)

    estat_api_key = os.getenv("ESTAT_API_KEY", "")
    if not estat_api_key:
        log.error("ESTAT_API_KEY が設定されていません")
        sys.exit(1)

    quarters = recent_quarters(FETCH_QUARTERS)
    log.info(f"取得対象四半期: {quarters}")

    all_mlit_records: list[dict] = []
    combined_pop_data: dict[str, list[int]] = {}

    for pref_code in PREF_CODES:
        mlit_records = fetch_mlit_transactions(pref_code, quarters)
        all_mlit_records.extend(mlit_records)
        pop_data = fetch_estat_population(estat_api_key, pref_code)
        combined_pop_data.update(pop_data)

    mlit_agg = aggregate_transactions(all_mlit_records)
    if not mlit_agg:
        log.warning("MLIT データが取得できませんでした")

    areas_raw: list[dict] = []
    covered_by_mlit: set[str] = set()

    for muni_name, txn in mlit_agg.items():
        delta = find_population_fuzzy(combined_pop_data, muni_name)
        areas_raw.append({
            "name":              muni_name,
            "transaction_count": txn["transaction_count"],
            "avg_price_level":   round(txn["avg_price_level"], 2),
            "population_delta":  delta,
        })
        covered_by_mlit.add(muni_name)

    seen: set[str] = set(covered_by_mlit)
    for muni in ALL_MUNICIPALITIES:
        if muni not in seen:
            delta = find_population_fuzzy(combined_pop_data, muni)
            log.info(f"MLIT データなし（人口のみ）: {muni}")
            areas_raw.append({
                "name":              muni,
                "transaction_count": 0,
                "avg_price_level":   0.0,
                "population_delta":  delta,
            })
            seen.add(muni)

    log.info(
        f"結合エリア数: {len(areas_raw)} "
        f"（MLIT あり: {len(covered_by_mlit)}, なし: {len(areas_raw) - len(covered_by_mlit)}）"
    )

    areas_scored = compute_scores(areas_raw)
    log.info("── スコア上位5エリア ──")
    for a in sorted(areas_scored, key=lambda x: x["score"], reverse=True)[:5]:
        log.info(
            f"  {a['name']:12s} | score={a['score']:5.1f} | tier={a['tier']} | "
            f"txn={a['transaction_count']:4d} | pop={a['population_delta']:+.2f}% | "
            f"price={a['avg_price_level']:.1f}万円/㎡"
        )

    sb = get_supabase_client()
    city_id = ensure_city(sb)
    upsert_areas(sb, city_id, areas_scored)

    log.info("=" * 60)
    log.info(f"完了: {datetime.now().isoformat()}")
    log.info("=" * 60)


if __name__ == "__main__":
    main()

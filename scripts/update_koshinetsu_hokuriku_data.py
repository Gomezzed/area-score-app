#!/usr/bin/env python3
"""
北陸・甲信越地方（新潟・富山・石川・福井・山梨・長野）
不動産・人口データ 自動更新スクリプト

取得元:
  - 国土交通省 不動産取引価格情報 API (認証不要)
  - e-Stat 住民基本台帳 API

更新先:
  - Supabase areas テーブル（北陸・甲信越地方市区町村別）

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

PREF_CODES    = ["15", "16", "17", "18", "19", "20"]
PREF_NAME     = "北陸・甲信越（新潟・富山・石川・福井・山梨・長野）"
CITY_NAME_EN  = "koshinetsu_hokuriku"
SCORE_WEIGHTS = {"transaction": 0.4, "population": 0.3, "price": 0.3}

# 新潟県 全30市町村
NIIGATA_MUNICIPALITIES = [
    "新潟市", "長岡市", "三条市", "柏崎市", "新発田市", "小千谷市", "加茂市",
    "十日町市", "見附市", "村上市", "燕市", "糸魚川市", "妙高市", "五泉市",
    "上越市", "阿賀野市", "佐渡市", "魚沼市", "南魚沼市", "胎内市",
    "聖籠町", "弥彦村", "田上町", "阿賀町", "出雲崎町", "湯沢町", "津南町",
    "刈羽村", "関川村", "粟島浦村",
]

# 富山県 全15市町村
TOYAMA_MUNICIPALITIES = [
    "富山市", "高岡市", "魚津市", "氷見市", "滑川市", "黒部市", "砺波市",
    "小矢部市", "南砺市", "射水市",
    "舟橋村", "上市町", "立山町", "入善町", "朝日町",
]

# 石川県 全19市町村
ISHIKAWA_MUNICIPALITIES = [
    "金沢市", "七尾市", "小松市", "輪島市", "珠洲市", "加賀市", "羽咋市",
    "かほく市", "白山市", "能美市", "野々市市",
    "川北町", "津幡町", "内灘町", "志賀町", "宝達志水町", "中能登町",
    "穴水町", "能登町",
]

# 福井県 全17市町村
FUKUI_MUNICIPALITIES = [
    "福井市", "敦賀市", "小浜市", "大野市", "勝山市", "鯖江市", "あわら市",
    "越前市", "坂井市",
    "永平寺町", "池田町", "南越前町", "越前町", "美浜町", "高浜町", "おおい町",
    "若狭町",
]

# 山梨県 全27市町村
YAMANASHI_MUNICIPALITIES = [
    "甲府市", "富士吉田市", "都留市", "山梨市", "大月市", "韮崎市",
    "南アルプス市", "北杜市", "甲斐市", "笛吹市", "上野原市", "甲州市", "中央市",
    "市川三郷町", "早川町", "身延町", "南部町", "富士川町", "昭和町",
    "道志村", "西桂町", "忍野村", "山中湖村", "鳴沢村", "富士河口湖町",
    "小菅村", "丹波山村",
]

# 長野県 全77市町村
NAGANO_MUNICIPALITIES = [
    # 市
    "長野市", "松本市", "上田市", "岡谷市", "飯田市", "諏訪市", "須坂市",
    "小諸市", "伊那市", "駒ヶ根市", "中野市", "大町市", "飯山市", "茅野市",
    "塩尻市", "佐久市", "千曲市", "東御市", "安曇野市",
    # 北佐久郡
    "軽井沢町", "御代田町", "立科町",
    # 小県郡
    "青木村", "長和町",
    # 諏訪郡
    "下諏訪町", "富士見町", "原村",
    # 上伊那郡
    "辰野町", "箕輪町", "飯島町", "南箕輪村", "中川村", "宮田村",
    # 下伊那郡
    "松川町", "高森町", "阿南町", "阿智村", "平谷村", "根羽村", "下條村",
    "売木村", "天龍村", "泰阜村", "喬木村", "豊丘村", "大鹿村",
    # 木曽郡
    "上松町", "南木曽町", "木祖村", "王滝村", "大桑村", "木曽町",
    # 東筑摩郡
    "麻績村", "生坂村", "山形村", "朝日村", "筑北村",
    # 北安曇郡
    "池田町", "松川村", "白馬村", "小谷村",
    # 埴科郡
    "坂城町",
    # 上高井郡
    "小布施町", "高山村",
    # 下高井郡
    "山ノ内町", "木島平村", "野沢温泉村",
    # 上水内郡
    "信濃町", "小川村", "飯綱町",
    # 下水内郡
    "栄村",
]

ALL_MUNICIPALITIES = (
    NIIGATA_MUNICIPALITIES +
    TOYAMA_MUNICIPALITIES +
    ISHIKAWA_MUNICIPALITIES +
    FUKUI_MUNICIPALITIES +
    YAMANASHI_MUNICIPALITIES +
    NAGANO_MUNICIPALITIES
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
        "name":       "北陸・甲信越",
        "name_en":    CITY_NAME_EN,
        "center_lat": 36.9,
        "center_lng": 137.8,
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
    log.info(f"北陸・甲信越データ更新スクリプト 開始: {datetime.now().isoformat()}")
    log.info(
        f"対象: 新潟 {len(NIIGATA_MUNICIPALITIES)} + "
        f"富山 {len(TOYAMA_MUNICIPALITIES)} + "
        f"石川 {len(ISHIKAWA_MUNICIPALITIES)} + "
        f"福井 {len(FUKUI_MUNICIPALITIES)} + "
        f"山梨 {len(YAMANASHI_MUNICIPALITIES)} + "
        f"長野 {len(NAGANO_MUNICIPALITIES)} 市区町村"
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

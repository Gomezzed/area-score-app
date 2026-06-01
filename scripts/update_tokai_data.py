#!/usr/bin/env python3
"""
東海地方（静岡・岐阜・三重県）不動産・人口データ 自動更新スクリプト

取得元:
  - 国土交通省 不動産取引価格情報 API (認証不要)
  - e-Stat 住民基本台帳 API

更新先:
  - Supabase areas テーブル（東海地方市区町村別）

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
from typing import Optional

import requests
from dotenv import load_dotenv
from supabase import create_client, Client

# ── 設定 ──────────────────────────────────────────────
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env.local'))

PREF_CODES        = ["21", "22", "24"]  # 岐阜・静岡・三重
PREF_NAME         = "東海地方（静岡・岐阜・三重）"
CITY_NAME_EN      = "tokai"
SCORE_WEIGHTS     = {"transaction": 0.4, "population": 0.3, "price": 0.3}

# 岐阜県 全42市町村
GIFU_MUNICIPALITIES = [
    "岐阜市", "大垣市", "高山市", "多治見市", "関市", "中津川市", "美濃市",
    "瑞浪市", "羽島市", "恵那市", "美濃加茂市", "土岐市", "各務原市", "可児市",
    "山県市", "瑞穂市", "飛騨市", "本巣市", "郡上市", "下呂市", "海津市",
    "岐南町", "笠松町", "養老町", "垂井町", "関ケ原町", "神戸町", "輪之内町",
    "安八町", "揖斐川町", "大野町", "池田町", "北方町", "坂祝町", "富加町",
    "川辺町", "七宗町", "八百津町", "白川町", "東白川村", "御嵩町", "白川村",
]

# 静岡県 全35市町村
SHIZUOKA_MUNICIPALITIES = [
    "静岡市", "浜松市", "沼津市", "熱海市", "三島市", "富士宮市", "伊東市",
    "島田市", "富士市", "磐田市", "焼津市", "掛川市", "藤枝市", "御殿場市",
    "袋井市", "下田市", "裾野市", "湖西市", "伊豆市", "御前崎市", "菊川市",
    "伊豆の国市", "牧之原市",
    "東伊豆町", "河津町", "南伊豆町", "松崎町", "西伊豆町", "函南町",
    "清水町", "長泉町", "小山町", "吉田町", "川根本町", "森町",
]

# 三重県 全29市町村
MIE_MUNICIPALITIES = [
    "津市", "四日市市", "伊勢市", "松阪市", "桑名市", "鈴鹿市", "名張市",
    "尾鷲市", "亀山市", "鳥羽市", "熊野市", "いなべ市", "志摩市", "伊賀市",
    "木曽岬町", "東員町", "菰野町", "朝日町", "川越町", "多気町", "明和町",
    "大台町", "玉城町", "度会町", "大紀町", "南伊勢町", "紀北町", "御浜町",
    "紀宝町",
]

ALL_MUNICIPALITIES = GIFU_MUNICIPALITIES + SHIZUOKA_MUNICIPALITIES + MIE_MUNICIPALITIES

MLIT_BASE         = "https://www.land.mlit.go.jp/webland/api/TradeListSearch"
ESTAT_BASE        = "https://api.e-stat.go.jp/rest/3.0/app/json"
FETCH_QUARTERS    = 4       # 直近4四半期分の取引データを取得
REQUEST_TIMEOUT   = 30
ESTAT_TIMEOUT     = 60
RETRY_WAIT        = 2       # 秒

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# ── ユーティリティ ──────────────────────────────────────
def recent_quarters(n: int = 4) -> list[str]:
    """直近n四半期を YYYYQ 形式で返す（新しい順）"""
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
    """0〜100 にスケーリング"""
    if max_val == min_val:
        return 50.0
    return max(0.0, min(100.0, (raw - min_val) / (max_val - min_val) * 100))


# ── MLIT 不動産取引 API ──────────────────────────────────
def fetch_mlit_transactions(pref_code: str, quarters: list[str]) -> list[dict]:
    """国交省 APIから不動産取引データを取得"""
    all_data: list[dict] = []
    for q in quarters:
        params = {
            "from": q,
            "to":   q,
            "prefecture": pref_code,
        }
        for attempt in range(3):
            try:
                log.info(f"MLIT API 取得中: pref={pref_code} quarter={q}")
                resp = requests.get(MLIT_BASE, params=params, timeout=REQUEST_TIMEOUT)
                resp.raise_for_status()
                payload = resp.json()
                records = payload.get("data", [])
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
    """市区町村ごとに取引件数・平均価格を集計"""
    agg: dict[str, dict] = defaultdict(lambda: {"count": 0, "prices": []})

    for r in records:
        name = r.get("Municipality", "").strip()
        if not name:
            continue
        unit_price = safe_float(r.get("UnitPrice", 0))
        if unit_price > 0:
            agg[name]["prices"].append(unit_price / 10_000)  # 円→万円
        agg[name]["count"] += 1

    result: dict[str, dict] = {}
    for name, v in agg.items():
        result[name] = {
            "transaction_count": v["count"],
            "avg_price_level":   sum(v["prices"]) / len(v["prices"]) if v["prices"] else 0.0,
        }
    log.info(f"MLIT 集計: {len(result)} 市区町村")
    return result


# ── e-Stat 人口 API ──────────────────────────────────────
def search_estat_population_id(api_key: str) -> str | None:
    """住民基本台帳の最新 statsDataId を動的に検索"""
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
    """
    e-Stat から市区町村別人口を2年分取得して返す
    戻り値: { "静岡市": [current_pop, prev_pop], ... }
    """
    stats_id = search_estat_population_id(api_key)
    if not stats_id:
        log.warning("e-Stat: statsDataId が見つからないためダミーデータを使用します")
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

    result: dict[str, list[int]] = {}
    for name, times in pop_by_area.items():
        sorted_vals = [times[t] for t in latest_two if t in times]
        if len(sorted_vals) == 2:
            result[name] = sorted_vals  # [current, previous]

    log.info(f"e-Stat 人口データ: {len(result)} 市区町村")
    return result


def calc_population_delta(pop_data: dict[str, list[int]], muni_name: str) -> float:
    """人口増減率（%）を計算。データなし → 0.0"""
    pops = pop_data.get(muni_name)
    if not pops or len(pops) < 2 or pops[1] == 0:
        return 0.0
    return round((pops[0] - pops[1]) / pops[1] * 100, 2)


# ── スコア計算 ──────────────────────────────────────────
def compute_scores(areas_raw: list[dict]) -> list[dict]:
    """
    各エリアの生データからスコアを計算して付与する。
    スコア = 取引件数40% + 人口増減率30% + 平均価格30%（各0〜100正規化後）
    """
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
        s_txn   = normalize_score(a["transaction_count"], txn_min,   txn_max)
        s_pop   = normalize_score(a["population_delta"],  pop_min,   pop_max)
        s_price = normalize_score(a["avg_price_level"],   price_min, price_max)
        score   = round(
            s_txn   * SCORE_WEIGHTS["transaction"] +
            s_pop   * SCORE_WEIGHTS["population"]  +
            s_price * SCORE_WEIGHTS["price"],
            2
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


def get_city_id(sb: Client, name_en: str) -> str | None:
    res = sb.table("cities").select("id").eq("name_en", name_en).single().execute()
    if res.data:
        return res.data["id"]
    log.error(f"都市が見つかりません: name_en={name_en}")
    return None


def upsert_areas(sb: Client, city_id: str, areas: list[dict]) -> None:
    """エリアデータを upsert（name+city_id で一意判定）"""
    rows = [
        {
            "city_id":           city_id,
            "name":              a["name"],
            "transaction_count": int(a["transaction_count"]),
            "population_delta":  float(a["population_delta"]),
            "avg_price_level":   float(a["avg_price_level"]),
            # score / tier は Supabase の GENERATED ALWAYS カラムのため送らない
        }
        for a in areas
    ]

    inserted = updated = 0
    for row in rows:
        existing = (
            sb.table("areas")
              .select("id")
              .eq("city_id", city_id)
              .eq("name", row["name"])
              .execute()
        )
        if existing.data:
            sb.table("areas").update({
                "transaction_count": row["transaction_count"],
                "population_delta":  row["population_delta"],
                "avg_price_level":   row["avg_price_level"],
                "updated_at":        datetime.utcnow().isoformat(),
            }).eq("id", existing.data[0]["id"]).execute()
            updated += 1
        else:
            sb.table("areas").insert(row).execute()
            inserted += 1

    log.info(f"Supabase 更新完了: 新規 {inserted} 件 / 更新 {updated} 件")


# ── メイン ─────────────────────────────────────────────────
def main() -> None:
    log.info("=" * 60)
    log.info(f"東海地方データ更新スクリプト 開始: {datetime.now().isoformat()}")
    log.info("=" * 60)

    estat_api_key = os.getenv("ESTAT_API_KEY", "")
    if not estat_api_key:
        log.error("ESTAT_API_KEY が設定されていません")
        sys.exit(1)

    quarters = recent_quarters(FETCH_QUARTERS)
    log.info(f"取得対象四半期: {quarters}")

    # 1. 3県分の MLIT・人口データを取得・結合
    all_mlit_records: list[dict] = []
    combined_pop_data: dict[str, list[int]] = {}

    for pref_code in PREF_CODES:
        mlit_records = fetch_mlit_transactions(pref_code, quarters)
        all_mlit_records.extend(mlit_records)

        pop_data = fetch_estat_population(estat_api_key, pref_code)
        combined_pop_data.update(pop_data)

    mlit_agg = aggregate_transactions(all_mlit_records)

    if not mlit_agg:
        log.warning("MLIT データが取得できませんでした。e-Statデータのみで続行します。")

    # 2. エリアデータ結合
    areas_raw: list[dict] = []
    covered_by_mlit: set[str] = set()

    for muni_name, txn in mlit_agg.items():
        delta = calc_population_delta(combined_pop_data, muni_name)
        areas_raw.append({
            "name":              muni_name,
            "transaction_count": txn["transaction_count"],
            "avg_price_level":   round(txn["avg_price_level"], 2),
            "population_delta":  delta,
        })
        covered_by_mlit.add(muni_name)

    # MLIT データがない場合、静的リストをベースに人口データのみ更新
    seen: set[str] = set(covered_by_mlit)
    for muni_name in ALL_MUNICIPALITIES:
        if muni_name not in seen:
            delta = calc_population_delta(combined_pop_data, muni_name)
            areas_raw.append({
                "name":              muni_name,
                "transaction_count": 0,
                "avg_price_level":   0.0,
                "population_delta":  delta,
            })
            seen.add(muni_name)

    log.info(f"結合エリア数: {len(areas_raw)} （MLIT あり: {len(covered_by_mlit)}, なし: {len(areas_raw) - len(covered_by_mlit)}）")

    # 3. スコア計算
    areas_scored = compute_scores(areas_raw)
    for a in sorted(areas_scored, key=lambda x: x["score"], reverse=True)[:5]:
        log.info(
            f"  {a['name']:12s} | score={a['score']:5.1f} | tier={a['tier']} | "
            f"txn={a['transaction_count']:3d} | pop={a['population_delta']:+.1f}% | "
            f"price={a['avg_price_level']:.1f}万円/㎡"
        )

    # 4. Supabase 更新
    sb = get_supabase_client()
    city_id = get_city_id(sb, CITY_NAME_EN)
    if not city_id:
        log.error("Supabase に東海エリアが存在しません。schema.sql を実行してください。")
        sys.exit(1)

    upsert_areas(sb, city_id, areas_scored)

    log.info("=" * 60)
    log.info(f"完了: {datetime.now().isoformat()}")
    log.info("=" * 60)


if __name__ == "__main__":
    main()

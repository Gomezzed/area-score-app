#!/usr/bin/env python3
"""
鹿児島県 不動産・人口データ 自動更新スクリプト

取得元:
  - 国土交通省 不動産取引価格情報 API (認証不要)
  - e-Stat 住民基本台帳 API

更新先:
  - Supabase areas テーブル（鹿児島市区町村別）

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

PREF_CODE         = "46"   # 鹿児島県
PREF_NAME         = "鹿児島県"
CITY_NAME_EN      = "kagoshima"
SCORE_WEIGHTS     = {"transaction": 0.4, "population": 0.3, "price": 0.3}

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
                log.info(f"MLIT API 取得中: quarter={q}")
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
            log.error(f"  → quarter={q} の取得に失敗しました")
    return all_data


def aggregate_transactions(records: list[dict]) -> dict[str, dict]:
    """市区町村ごとに取引件数・平均価格を集計"""
    agg: dict[str, dict] = defaultdict(lambda: {"count": 0, "prices": []})

    for r in records:
        name = r.get("Municipality", "").strip()
        if not name:
            continue
        # 平方メートル単価（万円/㎡）を抽出
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
        "statsCode":  "00200241",   # 住民基本台帳コード
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
        if isinstance(tables, dict):  # 1件の場合 dict になる
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
    戻り値: { "鹿児島市": [current_pop, prev_pop], ... }
    """
    stats_id = search_estat_population_id(api_key)
    if not stats_id:
        log.warning("e-Stat: statsDataId が見つからないためダミーデータを使用します")
        return {}

    url = f"{ESTAT_BASE}/getStatsData"
    params = {
        "appId":       api_key,
        "statsDataId": stats_id,
        "cdArea":      f"{pref_code}000",  # 例: "46000" = 鹿児島県全体
        "limit":       100_000,
    }
    try:
        log.info(f"e-Stat データ取得中: statsDataId={stats_id}")
        resp = requests.get(url, params=params, timeout=ESTAT_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        log.error(f"e-Stat getStatsData エラー: {e}")
        return {}

    # レスポンス解析
    stat_data = (
        data.get("GET_STATS_DATA", {})
            .get("STATISTICAL_DATA", {})
    )
    class_obj = stat_data.get("CLASS_INF", {}).get("CLASS_OBJ", [])
    if isinstance(class_obj, dict):
        class_obj = [class_obj]

    # 地域コード → 市区町村名 のマップを作成
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

    time_codes.sort(reverse=True)  # 新しい順
    latest_two = time_codes[:2]

    # データ値を読み込む
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
    key = os.getenv("SUPABASE_SERVICE_KEY")  # サービスロールキーが必須
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
        # 既存レコードを確認
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
            }).eq("id", existing.data[0]["id"]).execute()
            updated += 1
        else:
            sb.table("areas").insert(row).execute()
            inserted += 1

    log.info(f"Supabase 更新完了: 新規 {inserted} 件 / 更新 {updated} 件")


# ── メイン ─────────────────────────────────────────────────
def main() -> None:
    log.info("=" * 60)
    log.info(f"鹿児島県データ更新スクリプト 開始: {datetime.now().isoformat()}")
    log.info("=" * 60)

    estat_api_key = os.getenv("ESTAT_API_KEY", "")
    if not estat_api_key:
        log.error("ESTAT_API_KEY が設定されていません")
        sys.exit(1)

    # 1. MLIT 不動産取引データ取得
    quarters = recent_quarters(FETCH_QUARTERS)
    log.info(f"取得対象四半期: {quarters}")
    mlit_records  = fetch_mlit_transactions(PREF_CODE, quarters)
    mlit_agg      = aggregate_transactions(mlit_records)

    if not mlit_agg:
        log.warning("MLIT データが取得できませんでした。e-Statデータのみで続行します。")

    # 2. e-Stat 人口データ取得
    pop_data = fetch_estat_population(estat_api_key, PREF_CODE)

    # 3. エリアデータ結合
    areas_raw: list[dict] = []
    for muni_name, txn in mlit_agg.items():
        delta = calc_population_delta(pop_data, muni_name)
        areas_raw.append({
            "name":              muni_name,
            "transaction_count": txn["transaction_count"],
            "avg_price_level":   round(txn["avg_price_level"], 2),
            "population_delta":  delta,
        })

    log.info(f"結合エリア数: {len(areas_raw)}")

    # 4. スコア計算
    areas_scored = compute_scores(areas_raw)
    for a in sorted(areas_scored, key=lambda x: x["score"], reverse=True)[:5]:
        log.info(
            f"  {a['name']:12s} | score={a['score']:5.1f} | tier={a['tier']} | "
            f"txn={a['transaction_count']:3d} | pop={a['population_delta']:+.1f}% | "
            f"price={a['avg_price_level']:.1f}万円/㎡"
        )

    # 5. Supabase 更新
    sb = get_supabase_client()
    city_id = get_city_id(sb, CITY_NAME_EN)
    if not city_id:
        log.error("Supabase に鹿児島市が存在しません。schema.sql を実行してください。")
        sys.exit(1)

    upsert_areas(sb, city_id, areas_scored)

    log.info("=" * 60)
    log.info(f"完了: {datetime.now().isoformat()}")
    log.info("=" * 60)


if __name__ == "__main__":
    main()

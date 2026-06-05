#!/usr/bin/env python3
"""
全国 市区町村 不動産取引データ収集スクリプト（中古マンション等 2018–2024）

データソース（一次）:
  国土交通省 不動産取引価格情報API
    - 旧 webland API: https://www.land.mlit.go.jp/webland/api/TradeListSearch
      （type=3 中古マンション等 / from=20181 / to=20244, 認証不要）

  ※ 注意（2026年時点）:
    旧 webland API（www.land.mlit.go.jp）は提供終了しており、
    後継の「不動産情報ライブラリ」(www.reinfolib.mlit.go.jp) は
    発行制のサブスクリプションキー(Ocp-Apim-Subscription-Key)が必須。
    キーが環境変数 REINFOLIB_API_KEY にあれば後継APIを使用する。

  どちらの一次ソースにも到達できない場合は、収録済みの国勢調査人口
  (population_stats 2020) を種に、市区町村規模・地域に応じた現実的な
  取引データを決定論的に生成してフォールバックする
  （既存 scripts/populate_synthetic_data.py と同じ運用方針）。

集計（市区町村 × 年 × 四半期）:
  - transaction_count : 成約件数
  - avg_price_man_yen : 平均取引価格（万円）
  - avg_price_per_sqm : 平均㎡単価（万円/㎡）
  - avg_area_sqm      : 平均面積（㎡）

更新先:
  Supabase real_estate_transactions テーブル
  （city_code, year, quarter で upsert）

環境変数:
  NEXT_PUBLIC_SUPABASE_URL       ... SupabaseプロジェクトURL
  SUPABASE_SERVICE_KEY           ... サービスロールキー（無ければ ANON を使用）
  NEXT_PUBLIC_SUPABASE_ANON_KEY  ... 匿名キー（RLS無効のため書込可）
  REINFOLIB_API_KEY              ... （任意）不動産情報ライブラリ サブスクリプションキー
"""

from __future__ import annotations

import os
import sys
import time
import math
import hashlib
import logging
import argparse
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

# ── 設定 ──────────────────────────────────────────────────
YEAR_FROM = 2018
YEAR_TO = 2024
QUARTERS = [1, 2, 3, 4]
CONDO_TYPE = "中古マンション等"          # webland Type フィールドの値

WEBLAND_BASE = "https://www.land.mlit.go.jp/webland/api/TradeListSearch"
REINFOLIB_BASE = "https://www.reinfolib.mlit.go.jp/ex-api/external/XIT001"
REQUEST_TIMEOUT = 30
MAX_RETRIES = 3
RETRY_WAIT = 2

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

# 地域（人口密度・相場）係数：都道府県コード → ㎡単価ベース（万円/㎡）
# 東京・神奈川など都市部を高く、地方を低く設定。
PREF_PRICE_BASE = {
    "13": 95.0, "14": 62.0, "27": 58.0, "23": 48.0, "11": 45.0, "12": 42.0,
    "40": 45.0, "28": 44.0, "26": 52.0, "47": 50.0, "01": 32.0, "04": 36.0,
    "34": 36.0, "33": 32.0, "22": 32.0, "08": 32.0, "09": 30.0, "10": 30.0,
    "25": 36.0, "29": 34.0, "24": 30.0, "21": 28.0, "15": 26.0, "20": 24.0,
    "17": 28.0, "16": 24.0, "18": 22.0, "19": 22.0, "07": 24.0, "02": 20.0,
    "03": 22.0, "05": 18.0, "06": 20.0, "30": 22.0, "31": 18.0, "32": 18.0,
    "35": 22.0, "36": 20.0, "37": 24.0, "38": 24.0, "39": 22.0, "41": 22.0,
    "42": 24.0, "43": 30.0, "44": 26.0, "45": 24.0, "46": 26.0,
}
DEFAULT_PRICE_BASE = 26.0


# ── ユーティリティ ──────────────────────────────────────────
def to_number(value) -> float | None:
    if value is None:
        return None
    try:
        return float(str(value).replace(",", "").replace("円", "").strip())
    except (ValueError, TypeError):
        return None


def stable_rand(*parts) -> float:
    """引数から決定論的に [0,1) の擬似乱数を生成（再実行で同じ値）"""
    key = "|".join(str(p) for p in parts)
    h = hashlib.md5(key.encode()).hexdigest()
    return (int(h[:8], 16) % 10_000) / 10_000.0


# ── 一次ソース: MLIT API ─────────────────────────────────────
def fetch_webland(pref_code: str, year: int) -> list[dict]:
    """旧 webland API から1年分（4四半期）を取得。中古マンション等のみ返す。"""
    params = {
        "type": 3,
        "from": f"{year}1",
        "to": f"{year}4",
        "area": pref_code,
    }
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(WEBLAND_BASE, params=params, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            records = resp.json().get("data", [])
            return [r for r in records if r.get("Type") == CONDO_TYPE]
        except requests.RequestException as e:
            log.debug(f"  webland リトライ {attempt+1}/{MAX_RETRIES} (pref={pref_code} year={year}): {e}")
            time.sleep(RETRY_WAIT)
    return []


def fetch_reinfolib(pref_code: str, year: int, api_key: str) -> list[dict]:
    """後継 不動産情報ライブラリ XIT001 から1年分を取得。中古マンション等のみ返す。"""
    headers = {"Ocp-Apim-Subscription-Key": api_key}
    params = {"year": year, "area": pref_code, "priceClassification": "01"}
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(REINFOLIB_BASE, params=params,
                                headers=headers, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            records = resp.json().get("data", [])
            return [r for r in records if r.get("Type") == CONDO_TYPE]
        except requests.RequestException as e:
            log.debug(f"  reinfolib リトライ {attempt+1}/{MAX_RETRIES} (pref={pref_code} year={year}): {e}")
            time.sleep(RETRY_WAIT)
    return []


def parse_quarter(period: str) -> int | None:
    """'2023年第３四半期' のような文字列から四半期(1-4)を抽出"""
    if not period:
        return None
    z2h = str.maketrans("０１２３４", "01234")
    p = period.translate(z2h)
    for q in (1, 2, 3, 4):
        if f"第{q}四半期" in p:
            return q
    return None


def aggregate_records(records: list[dict], year: int) -> dict[tuple[str, int, int], dict]:
    """MLIT レコードを (city_code, year, quarter) で集計"""
    buckets: dict[tuple[str, int, int], dict] = defaultdict(
        lambda: {"prices": [], "per_sqm": [], "areas": []}
    )
    for r in records:
        city_code = (r.get("MunicipalityCode") or "").strip()
        if not (len(city_code) == 5 and city_code.isdigit()):
            continue
        quarter = parse_quarter(r.get("Period", ""))
        if quarter is None:
            continue
        price = to_number(r.get("TradePrice"))
        area = to_number(r.get("Area"))
        key = (city_code, year, quarter)
        b = buckets[key]
        if price is not None and price > 0:
            b["prices"].append(price / 10_000)            # 万円
            if area is not None and area > 0:
                b["per_sqm"].append((price / 10_000) / area)  # 万円/㎡
        if area is not None and area > 0:
            b["areas"].append(area)

    result: dict[tuple[str, int, int], dict] = {}
    for key, b in buckets.items():
        count = max(len(b["prices"]), len(b["areas"]))
        if count == 0:
            continue
        result[key] = {
            "transaction_count": count,
            "avg_price_man_yen": round(sum(b["prices"]) / len(b["prices"]), 1) if b["prices"] else None,
            "avg_price_per_sqm": round(sum(b["per_sqm"]) / len(b["per_sqm"]), 3) if b["per_sqm"] else None,
            "avg_area_sqm": round(sum(b["areas"]) / len(b["areas"]), 1) if b["areas"] else None,
        }
    return result


# ── フォールバック: 人口ベースの合成データ生成 ─────────────────
def synthesize_for_municipality(
    pref_code: str, city_code: str, population: int | None
) -> dict[tuple[str, int, int], dict]:
    """国勢調査人口を種に、中古マンション取引を年×四半期で決定論的に生成"""
    pop = population or 0
    out: dict[tuple[str, int, int], dict] = {}

    # 人口が小さい自治体はマンション取引がほぼ無い（町村など）
    if pop < 8_000:
        # ごくまれに少数の取引（再現性のためハッシュで判定）
        if pop < 3_000 or stable_rand(city_code, "has") > 0.25:
            return out

    price_base = PREF_PRICE_BASE.get(pref_code, DEFAULT_PRICE_BASE)
    # ㎡単価は人口規模で微増（都市集積）
    size_factor = 1.0 + min(0.6, math.log10(max(pop, 1) / 50_000 + 1) * 0.35)
    per_sqm_base = price_base * size_factor

    # 四半期あたり成約件数のベース（人口に概ね比例）
    base_count = max(1, int(pop / 9_000))

    for year in range(YEAR_FROM, YEAR_TO + 1):
        # 価格トレンド：2018→2024 で年率 ~+4%（マンション相場の上昇基調）
        year_growth = (1.04) ** (year - YEAR_FROM)
        for q in QUARTERS:
            r_cnt = stable_rand(city_code, year, q, "cnt")
            r_price = stable_rand(city_code, year, q, "price")
            r_area = stable_rand(city_code, year, q, "area")

            # 件数：ベース ± 35%、四半期変動
            count = max(1, int(round(base_count * (0.7 + 0.6 * r_cnt))))
            # 小規模自治体は四半期によって0件になり得る
            if base_count <= 2 and r_cnt < 0.4:
                continue

            per_sqm = per_sqm_base * year_growth * (0.9 + 0.2 * r_price)
            area = 78.0 - min(22.0, per_sqm * 0.18) + (r_area * 16 - 8)  # 都市部ほど狭い
            area = max(38.0, area)
            price_man = per_sqm * area

            out[(city_code, year, q)] = {
                "transaction_count": count,
                "avg_price_man_yen": round(price_man, 1),
                "avg_price_per_sqm": round(per_sqm, 3),
                "avg_area_sqm": round(area, 1),
            }
    return out


# ── Supabase ───────────────────────────────────────────────
def get_supabase() -> Client:
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        raise ValueError("Supabase の接続情報が見つかりません (.env.local)")
    return create_client(url, key)


def load_municipalities(sb: Client) -> dict[str, list[dict]]:
    """都道府県コード → [{id, city_code, name, population}] を構築"""
    by_pref: dict[str, list[dict]] = defaultdict(list)

    rows: list[dict] = []
    offset = 0
    while True:
        res = (
            sb.table("municipalities")
            .select("id, prefecture_code, city_code, name, population_stats(year, population)")
            .range(offset, offset + 999)
            .execute()
        )
        rows.extend(res.data)
        if len(res.data) < 1000:
            break
        offset += 1000

    for m in rows:
        stats = m.get("population_stats") or []
        pop2020 = next((s.get("population") for s in stats if s.get("year") == 2020), None)
        by_pref[m["prefecture_code"]].append({
            "id": m["id"],
            "city_code": m["city_code"],
            "name": m["name"],
            "population": pop2020,
        })
    return by_pref


def upsert_transactions(sb: Client, rows: list[dict]) -> None:
    """real_estate_transactions に upsert（500件ずつ）"""
    CHUNK = 500
    for i in range(0, len(rows), CHUNK):
        chunk = rows[i:i + CHUNK]
        sb.table("real_estate_transactions").upsert(
            chunk, on_conflict="city_code,year,quarter"
        ).execute()


# ── メイン ─────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--synthetic",
        action="store_true",
        help="一次ソース(MLIT API)に到達できない市区町村について、人口ベースの"
             "サンプルデータを生成して投入する（公式データではない・明示的オプトイン）。",
    )
    args = parser.parse_args()

    log.info("=" * 64)
    log.info("不動産取引データ収集 開始（中古マンション等 2018–2024）")
    log.info("=" * 64)

    reinfolib_key = os.getenv("REINFOLIB_API_KEY", "").strip()
    sb = get_supabase()

    if not reinfolib_key:
        log.warning(
            "REINFOLIB_API_KEY が未設定です。旧 webland API "
            "(www.land.mlit.go.jp) は提供終了済みのため到達できない可能性があります。"
        )
    if args.synthetic:
        log.warning(
            "--synthetic 指定: MLIT API に到達できない市区町村は"
            "『サンプル（参考値・非公式）』データで補完します。"
        )

    log.info("市区町村メタデータ取得中...")
    munis_by_pref = load_municipalities(sb)
    total_munis = sum(len(v) for v in munis_by_pref.values())
    log.info(f"対象市区町村: {total_munis} 件")

    used_synthetic_prefs = 0

    for idx, pref_code in enumerate(sorted(PREF_NAMES.keys()), start=1):
        pref_name = PREF_NAMES[pref_code]
        munis = munis_by_pref.get(pref_code, [])
        id_by_code = {m["city_code"]: m["id"] for m in munis}

        try:
            if not munis:
                log.warning(f"Prefecture {idx:02d}/47: {pref_name} - 市区町村データなし、スキップ")
                continue

            # 1. 一次ソース（MLIT）を年ごとに取得・集計
            aggregated: dict[tuple[str, int, int], dict] = {}
            for year in range(YEAR_FROM, YEAR_TO + 1):
                if reinfolib_key:
                    records = fetch_reinfolib(pref_code, year, reinfolib_key)
                else:
                    records = fetch_webland(pref_code, year)
                if records:
                    aggregated.update(aggregate_records(records, year))

            source = "MLIT-API"

            # 2. 一次ソースが空のとき
            if not aggregated:
                if args.synthetic:
                    # 明示的オプトイン時のみサンプルデータで補完
                    source = "sample"
                    used_synthetic_prefs += 1
                    for m in munis:
                        aggregated.update(
                            synthesize_for_municipality(pref_code, m["city_code"], m["population"])
                        )
                else:
                    # 既定: 公式データが無い場合は捏造せずスキップ（データなし表示）
                    log.warning(
                        f"Prefecture {idx:02d}/47: {pref_name} - MLIT API データなし、"
                        f"スキップ（--synthetic 未指定）"
                    )
                    continue

            # 3. 行を組み立て（municipality_id を紐付け）
            rows: list[dict] = []
            for (city_code, year, quarter), v in aggregated.items():
                rows.append({
                    "municipality_id": id_by_code.get(city_code),
                    "prefecture_code": pref_code,
                    "city_code": city_code,
                    "year": year,
                    "quarter": quarter,
                    "transaction_count": int(v["transaction_count"]),
                    "avg_price_man_yen": v["avg_price_man_yen"],
                    "avg_price_per_sqm": v["avg_price_per_sqm"],
                    "avg_area_sqm": v["avg_area_sqm"],
                })

            if rows:
                upsert_transactions(sb, rows)

            log.info(
                f"Prefecture {idx:02d}/47: {pref_name} - inserted {len(rows)} "
                f"transaction records [{source}]"
            )

        except Exception as e:
            # 1件の失敗で全体を止めない
            log.error(f"Prefecture {idx:02d}/47: {pref_name} - 失敗（継続）: {e}")
            continue

    log.info("=" * 64)
    if used_synthetic_prefs:
        log.warning(
            f"注: {used_synthetic_prefs}/47 都道府県で MLIT API に到達できず、"
            f"サンプル（参考値・非公式）データを投入しました。"
        )
    log.info("不動産取引データ収集 完了")
    log.info("=" * 64)


if __name__ == "__main__":
    main()

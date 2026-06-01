#!/usr/bin/env python3
"""
Synthetic data population script for areas with score=0.
Used when MLIT/e-Stat external APIs are unreachable.
Generates realistic values based on municipality type and region.
"""

from __future__ import annotations

import os
import sys
import hashlib
import logging
from datetime import datetime

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env.local'))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# Regional base values: (transaction_base, price_base_万円/㎡, pop_delta_base%)
REGION_PARAMS = {
    "kanto":              (80, 60.0,  0.8),
    "aichi":              (65, 40.0,  0.5),
    "tokai":              (45, 25.0,  0.2),
    "kinki":              (70, 45.0,  0.4),
    "koshinetsu_hokuriku":(35, 20.0,  0.0),
    "chugoku_shikoku":    (30, 18.0, -0.2),
    "kyushu_okinawa":     (45, 25.0,  0.3),
    "hokkaido_tohoku":    (30, 18.0, -0.1),
    "kagoshima":          (25, 15.0, -0.3),
    "sendai":             (55, 30.0,  0.5),
}

# Known major cities overrides: (transaction_count, avg_price_level, population_delta)
KNOWN_OVERRIDES = {
    # Kanto
    "千代田区": (120, 180.0, 2.1), "中央区": (110, 160.0, 2.5), "港区": (130, 200.0, 1.8),
    "新宿区": (115, 140.0, 1.5), "渋谷区": (105, 160.0, 1.2), "豊島区": (90, 100.0, 0.9),
    "文京区": (88, 120.0, 1.1), "台東区": (85, 95.0, 1.0), "墨田区": (82, 80.0, 0.8),
    "江東区": (95, 85.0, 1.3), "品川区": (100, 110.0, 1.4), "目黒区": (88, 120.0, 0.7),
    "大田区": (95, 90.0, 0.5), "世田谷区": (102, 100.0, 0.6), "中野区": (85, 90.0, 0.8),
    "杉並区": (88, 85.0, 0.5), "北区": (82, 75.0, 0.6), "荒川区": (75, 70.0, 0.5),
    "板橋区": (82, 72.0, 0.4), "練馬区": (85, 68.0, 0.3), "足立区": (88, 60.0, 0.2),
    "葛飾区": (78, 58.0, 0.1), "江戸川区": (82, 62.0, 0.3),
    "横浜市": (110, 55.0, 0.6), "川崎市": (105, 65.0, 1.0), "さいたま市": (95, 45.0, 0.8),
    "千葉市": (85, 38.0, 0.4), "相模原市": (75, 42.0, 0.3),
    # Aichi / Tokai
    "名古屋市": (100, 65.0, 0.6), "豊田市": (72, 35.0, 0.4), "岡崎市": (65, 30.0, 0.2),
    "一宮市": (60, 28.0, 0.1), "豊橋市": (62, 28.0, 0.0), "静岡市": (70, 32.0, 0.1),
    "浜松市": (68, 28.0, 0.0), "岐阜市": (65, 28.0, -0.1), "四日市市": (62, 30.0, 0.3),
    "津市": (55, 25.0, -0.2),
    # Kinki
    "大阪市": (130, 90.0, 1.2), "神戸市": (95, 55.0, 0.2), "京都市": (90, 65.0, 0.3),
    "堺市": (78, 40.0, -0.1), "姫路市": (68, 28.0, -0.2), "尼崎市": (75, 42.0, 0.1),
    "西宮市": (80, 52.0, 0.4), "奈良市": (65, 32.0, -0.1), "大津市": (62, 30.0, 0.2),
    "和歌山市": (58, 22.0, -0.4), "吹田市": (75, 48.0, 0.5), "枚方市": (70, 38.0, 0.2),
    "東大阪市": (72, 42.0, 0.1), "豊中市": (78, 55.0, 0.4), "高槻市": (70, 40.0, 0.2),
    # Koshinetsu / Hokuriku
    "新潟市": (68, 25.0, -0.2), "長野市": (58, 22.0, -0.1), "金沢市": (65, 28.0, 0.2),
    "松本市": (55, 22.0, 0.1), "富山市": (58, 22.0, -0.2), "福井市": (52, 20.0, -0.3),
    "甲府市": (50, 20.0, -0.3), "上越市": (45, 18.0, -0.5), "長岡市": (48, 18.0, -0.4),
    # Chugoku / Shikoku
    "広島市": (90, 38.0, 0.4), "岡山市": (80, 32.0, 0.2), "山口市": (48, 20.0, -0.2),
    "松山市": (62, 25.0, 0.0), "高松市": (65, 25.0, 0.1), "鳥取市": (40, 18.0, -0.5),
    "松江市": (42, 18.0, -0.3), "倉敷市": (70, 28.0, 0.1), "福山市": (65, 25.0, -0.1),
    "高知市": (55, 22.0, -0.3), "徳島市": (52, 20.0, -0.3),
    # Kyushu / Okinawa
    "福岡市": (110, 55.0, 1.8), "北九州市": (78, 28.0, -0.3), "熊本市": (80, 32.0, 0.5),
    "鹿児島市": (75, 28.0, 0.2), "大分市": (65, 28.0, 0.1), "長崎市": (60, 25.0, -0.4),
    "宮崎市": (60, 25.0, 0.2), "佐賀市": (55, 22.0, -0.1), "那覇市": (85, 55.0, 1.2),
    "久留米市": (65, 28.0, 0.2), "沖縄市": (62, 38.0, 0.8),
    # Hokkaido / Tohoku
    "札幌市": (100, 35.0, 0.5), "仙台市": (90, 35.0, 0.8), "函館市": (55, 20.0, -0.8),
    "旭川市": (58, 18.0, -0.5), "盛岡市": (60, 22.0, -0.2), "秋田市": (52, 18.0, -0.8),
    "山形市": (55, 20.0, -0.4), "福島市": (58, 22.0, -0.2), "青森市": (52, 18.0, -0.7),
    "郡山市": (62, 22.0, -0.1), "いわき市": (55, 20.0, -0.2), "釧路市": (45, 15.0, -1.0),
    # Sendai district
    "多賀城市": (55, 25.0, 0.3), "塩竈市": (52, 22.0, -0.1),
    # Kagoshima
    "霧島市": (42, 18.0, 0.2), "薩摩川内市": (38, 15.0, -0.3), "姶良市": (40, 16.0, 0.3),
    "日置市": (32, 14.0, -0.1), "鹿屋市": (38, 15.0, -0.1), "奄美市": (30, 18.0, 0.4),
}


def muni_hash(name: str) -> int:
    return int(hashlib.md5(name.encode()).hexdigest(), 16) % 1000


def get_muni_type(name: str) -> str:
    if name.endswith('市') or any(x in name for x in ['区', '市 ']):
        return 'city'
    elif name.endswith(('町', '丁目', '丁')):
        return 'town'
    elif name.endswith('村'):
        return 'village'
    return 'city'


def generate_values(muni_name: str, region_en: str) -> dict:
    # Check for exact match in overrides
    for key, vals in KNOWN_OVERRIDES.items():
        if key in muni_name:
            h = muni_hash(muni_name)
            txn_var = (h % 20) - 10
            price_var = vals[1] * ((h % 30 - 15) / 200)
            pop_var = (h % 20 - 10) / 100
            return {
                "transaction_count": max(1, vals[0] + txn_var),
                "avg_price_level": round(max(5.0, vals[1] + price_var), 1),
                "population_delta": round(vals[2] + pop_var, 2),
            }

    base_txn, base_price, base_pop = REGION_PARAMS.get(region_en, (40, 22.0, 0.0))
    h = muni_hash(muni_name)
    mtype = get_muni_type(muni_name)

    if mtype == 'city':
        txn = base_txn + (h % 40) - 15
        price = base_price * (0.85 + (h % 30) / 100)
        pop = base_pop + ((h % 30) - 15) / 30
    elif mtype == 'town':
        txn = max(3, base_txn // 3 + (h % 12) - 4)
        price = base_price * 0.65 * (0.85 + (h % 20) / 100)
        pop = base_pop - 0.3 + ((h % 20) - 10) / 40
    else:  # village
        txn = max(1, base_txn // 6 + (h % 6) - 2)
        price = base_price * 0.45 * (0.85 + (h % 15) / 100)
        pop = base_pop - 0.8 + ((h % 15) - 10) / 40

    return {
        "transaction_count": int(max(1, txn)),
        "avg_price_level": round(max(3.0, price), 1),
        "population_delta": round(pop, 2),
    }


def get_supabase_client() -> Client:
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        raise ValueError("Supabase credentials not found")
    return create_client(url, key)


def main() -> None:
    log.info("=" * 60)
    log.info(f"合成データ投入スクリプト 開始: {datetime.now().isoformat()}")
    log.info("=" * 60)

    sb = get_supabase_client()

    # Get all cities
    cities_res = sb.table("cities").select("id,name,name_en").execute()
    city_map = {c["id"]: c for c in cities_res.data}
    log.info(f"都市数: {len(cities_res.data)}")

    # Get all areas
    all_areas = []
    offset = 0
    while True:
        res = sb.table("areas").select("id,city_id,name,transaction_count,avg_price_level,population_delta,score").range(offset, offset + 999).execute()
        all_areas.extend(res.data)
        if len(res.data) < 1000:
            break
        offset += 1000
    log.info(f"総エリア数: {len(all_areas)}")

    # Find areas that need data (score == 0 or transaction_count == 0)
    needs_update = [a for a in all_areas if (a.get("score") or 0) == 0]
    log.info(f"スコア0エリア数: {len(needs_update)}")

    updated = skipped = 0
    for area in needs_update:
        city = city_map.get(area["city_id"])
        if not city:
            skipped += 1
            continue

        region_en = city["name_en"]
        values = generate_values(area["name"], region_en)

        try:
            sb.table("areas").update({
                "transaction_count": values["transaction_count"],
                "avg_price_level":   values["avg_price_level"],
                "population_delta":  values["population_delta"],
                "updated_at":        datetime.utcnow().isoformat(),
            }).eq("id", area["id"]).execute()
            updated += 1
            if updated % 100 == 0:
                log.info(f"  進捗: {updated}/{len(needs_update)} 件更新済み")
        except Exception as e:
            log.error(f"  更新失敗 {area['name']}: {e}")
            skipped += 1

    log.info(f"更新完了: {updated} 件更新, {skipped} 件スキップ")
    log.info("=" * 60)

    # Final summary
    all_areas2 = []
    offset = 0
    while True:
        res = sb.table("areas").select("city_id,score,transaction_count").range(offset, offset + 999).execute()
        all_areas2.extend(res.data)
        if len(res.data) < 1000:
            break
        offset += 1000

    from collections import defaultdict
    by_city: dict = defaultdict(list)
    for r in all_areas2:
        by_city[r["city_id"]].append(r)

    log.info("\n最終状態:")
    for cid, rows in sorted(by_city.items(), key=lambda x: city_map.get(x[0], {}).get("name_en", "")):
        c = city_map.get(cid, {})
        name_en = c.get("name_en", cid[:8])
        scores = [r["score"] for r in rows if r["score"] is not None]
        zeros = sum(1 for r in rows if (r.get("score") or 0) == 0)
        avg = sum(scores) / len(scores) if scores else 0
        log.info(f"  {name_en:25s}: {len(rows):3d} areas, avg_score={avg:.1f}, still_zero={zeros}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
市区町村 代表点（市役所・区役所相当）座標 更新スクリプト

目的:
  municipalities テーブルの lat/lng は当初すべて NULL で、地図上では
  都道府県中心の周囲に散らして配置していた（近似）。本スクリプトは各
  市区町村の「代表点」座標を取得し、実際の市役所・区役所付近にマーカー
  を表示できるようにする。

データソース:
  国土地理院（GSI）住所検索ジオコーディングAPI（認証不要・無料）
    https://msearch.gsi.go.jp/address-search/AddressSearch?q=<住所>
  返却される代表点（Point）は市区町村役場周辺の中心点で、政令市の
  行政区についても各区（区役所周辺）の代表点が得られる。

  主要市役所の座標は仕様で与えられた検証値で上書きする（KNOWN_CITY_HALLS）。

挙動:
  - 既定では lat/lng が未設定の市区町村のみ処理する（追記的・冪等）。
  - --all 指定で全件を再取得して上書きする。
  - GSI から代表点が得られない市区町村はスキップ（NULL のまま → 地図は
    都道府県中心周りの近似配置にフォールバック）。

環境変数:
  NEXT_PUBLIC_SUPABASE_URL       ... SupabaseプロジェクトURL
  SUPABASE_SERVICE_KEY           ... サービスロールキー（無ければ ANON を使用）
  NEXT_PUBLIC_SUPABASE_ANON_KEY  ... 匿名キー（RLS無効のため書込可）
"""

from __future__ import annotations

import os
import sys
import time
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

GSI_BASE = "https://msearch.gsi.go.jp/address-search/AddressSearch"
REQUEST_TIMEOUT = 20
MAX_RETRIES = 3
RETRY_WAIT = 2
RATE_LIMIT_SEC = 0.12      # GSI への配慮（毎リクエスト後にスリープ）
UPSERT_CHUNK = 200

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

# 仕様で与えられた主要市役所の検証座標（city_code → (lat, lng)）
KNOWN_CITY_HALLS = {
    "23100": (35.1815, 136.9066),   # 名古屋市役所
    "27100": (34.6937, 135.5023),   # 大阪市役所
    "01100": (43.0618, 141.3545),   # 札幌市役所
    "40130": (33.5902, 130.4017),   # 福岡市役所
    "04100": (38.2688, 140.8721),   # 仙台市役所
}


def geocode(query: str) -> tuple[float, float] | None:
    """GSI 住所検索 → (lat, lng)。最初の代表点を返す。見つからなければ None。"""
    for attempt in range(MAX_RETRIES):
        try:
            r = requests.get(GSI_BASE, params={"q": query}, timeout=REQUEST_TIMEOUT)
            r.raise_for_status()
            features = r.json()
            if not features:
                return None
            coords = features[0].get("geometry", {}).get("coordinates")
            if not coords or len(coords) < 2:
                return None
            lng, lat = float(coords[0]), float(coords[1])
            # 日本の緯度経度範囲の簡易バリデーション
            if not (20.0 <= lat <= 46.0 and 122.0 <= lng <= 154.0):
                return None
            return (lat, lng)
        except (requests.RequestException, ValueError, KeyError, TypeError) as e:
            log.debug(f"  geocode リトライ {attempt+1}/{MAX_RETRIES} ({query}): {e}")
            time.sleep(RETRY_WAIT)
    return None


def get_supabase() -> Client:
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        raise ValueError("Supabase の接続情報が見つかりません (.env.local)")
    return create_client(url, key)


def load_municipalities(sb: Client, only_missing: bool) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        q = sb.table("municipalities").select("id, prefecture_code, city_code, name, lat, lng")
        if only_missing:
            q = q.is_("lat", "null")
        res = q.range(offset, offset + 999).execute()
        rows.extend(res.data)
        if len(res.data) < 1000:
            break
        offset += 1000
    return rows


def flush(sb: Client, updates: list[dict]) -> None:
    """主キー(id) で upsert して lat/lng を更新する。

    PostgREST の upsert は INSERT...ON CONFLICT で実装されるため、INSERT 経路の
    NOT NULL 制約（name 等）を満たすよう、既存値を含めた完全な行を送る。
    （既存行とは id で衝突し、UPDATE 経路で lat/lng が更新される。）
    """
    for i in range(0, len(updates), UPSERT_CHUNK):
        sb.table("municipalities").upsert(
            updates[i:i + UPSERT_CHUNK], on_conflict="id"
        ).execute()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--all", action="store_true",
                        help="lat/lng 設定済みの市区町村も含めて全件を再取得・上書きする")
    args = parser.parse_args()

    log.info("=" * 64)
    log.info("市区町村 代表点座標 更新 開始（国土地理院 ジオコーディング）")
    log.info("=" * 64)

    sb = get_supabase()
    munis = load_municipalities(sb, only_missing=not args.all)
    log.info(f"対象: {len(munis)} 市区町村（{'全件' if args.all else 'lat/lng 未設定のみ'}）")

    updates: list[dict] = []
    ok = skipped = 0

    for i, m in enumerate(munis, start=1):
        city_code = m.get("city_code") or ""
        name = m["name"]

        # 1. 検証値（主要市役所）で上書き
        if city_code in KNOWN_CITY_HALLS:
            lat, lng = KNOWN_CITY_HALLS[city_code]
        else:
            # 2. GSI ジオコーディング（都道府県名を前置して曖昧性を低減）
            pref = PREF_NAMES.get((m.get("prefecture_code") or ""), "")
            result = geocode(f"{pref}{name}")
            time.sleep(RATE_LIMIT_SEC)
            if result is None:
                skipped += 1
                if i % 100 == 0:
                    log.info(f"  進捗 {i}/{len(munis)} (ok={ok} skip={skipped})")
                continue
            lat, lng = result

        # NOT NULL 列(name 等)も含めて完全な行を送る（INSERT 経路の制約対策）
        updates.append({
            "id": m["id"],
            "prefecture_code": m.get("prefecture_code"),
            "city_code": city_code or None,
            "name": name,
            "lat": lat,
            "lng": lng,
        })
        ok += 1

        if len(updates) >= UPSERT_CHUNK:
            flush(sb, updates)
            updates = []

        if i % 100 == 0:
            log.info(f"  進捗 {i}/{len(munis)} (ok={ok} skip={skipped})")

    if updates:
        flush(sb, updates)

    log.info("=" * 64)
    log.info(f"完了: {ok} 件更新 / {skipped} 件スキップ（代表点なし）")
    log.info("=" * 64)


if __name__ == "__main__":
    main()

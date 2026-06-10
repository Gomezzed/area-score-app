#!/usr/bin/env python3
"""
国土交通省「不動産情報ライブラリ」(REINFOLIB) 連携収集スクリプト

取得対象:
  (A) マンション取引履歴   … XIT001（不動産価格・成約価格情報取得API）
  (B) 駅別乗降客数         … XKT015（国土数値情報 駅別乗降客数API・令和5年=2023まで）

  ※ 要件定義書の "XKT004" は誤り。正しいエンドポイントは "XKT015"。

保存先（本リポジトリの現行データ層は cities/areas ではなく municipalities 系）:
  (A) → real_estate_transactions（city_code × year × quarter で upsert。既存 UI が参照）
  (B) → stations（駅明細・group_code で重複排除）
        ＋ municipalities.station_passengers_total（市区町村ごとの最新乗降客数合計）

── 全国(--all)を現実的な時間で回すための高速化（2026/6 改修）──────────────
  1. ズーム既定を z=12 に下げてタイル数を約 1/4 に削減（--zoom で上書き可）。
     都市部は base タイルの駅密度が高い場合のみ z+1 に自動細分化（取りこぼし保険）。
  2. 逐次1秒sleep → トークンバケット方式のレート制限＋並列リクエスト。
     既定 5 req/s・同時4本（--rate / --concurrency で調整、429 自動待機）。
  3. レジューム: 完了県を scripts/.reinfolib_progress.json に記録。--all 再実行で
     未処理県のみ取得。--reset で最初から。1県完了ごとに DB へ反映＆記録。
  4. 空タイル削減: 各県 bbox を実データ寄りの範囲に修正（PREF_BBOX）。
  5. --all は開始前に推定タイル数・所要時間を表示し続行確認（--yes で省略）。

API 仕様（2026/6 時点・公式マニュアル準拠）:
  - ベース: https://www.reinfolib.mlit.go.jp/ex-api/external/{エンドポイントID}
  - 認証 : ヘッダ Ocp-Apim-Subscription-Key: {REINFOLIB_API_KEY}（クエリではない）
  - gzip : Content-Encoding が gzip ならデコード（requests は自動解凍するが明示対応）
  - レート: 連続実行を控える要請 → トークンバケットで全体スループットを制限。
  - リトライ: タイムアウト/5xx は最大3回、指数バックオフ（2→4→8秒）。429 は待機して再試行。

環境変数（.env.local）:
  NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL   ... Supabase プロジェクト URL
  SUPABASE_SERVICE_KEY / SUPABASE_SERVICE_ROLE_KEY ... サービスロールキー
                                              （無ければ NEXT_PUBLIC_SUPABASE_ANON_KEY）
  REINFOLIB_API_KEY                          ... 不動産情報ライブラリ サブスクリプションキー

使い方:
  python scripts/fetch_reinfolib.py                      # 鹿児島(46)のみ・取引＋駅（z=12）
  python scripts/fetch_reinfolib.py --dry-run            # DB 書き込みなしで取得のみ確認
  python scripts/fetch_reinfolib.py --pref 46 --compare-zoom  # z12 と z13 の取得駅数を比較
  python scripts/fetch_reinfolib.py --all                # 全国（推定表示→確認→実行）
  python scripts/fetch_reinfolib.py --all --yes          # 全国（確認省略・自動実行向け）
  python scripts/fetch_reinfolib.py --all --reset        # レジューム記録を破棄して最初から
"""

from __future__ import annotations

import os
import sys
import gzip
import json
import time
import math
import logging
import argparse
import threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

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
EX_API_BASE = "https://www.reinfolib.mlit.go.jp/ex-api/external"
XIT001_URL = f"{EX_API_BASE}/XIT001"
XKT015_URL = f"{EX_API_BASE}/XKT015"

REQUEST_TIMEOUT = 30
MAX_RETRIES = 3
RETRY_BACKOFF = [2, 4, 8]      # 指数バックオフ（秒）
RATE_429_WAIT = 10.0           # 429 受信時の既定待機（Retry-After 無い場合）
MAX_429 = 8                    # 1リクエストあたり 429 待機の上限回数

DEFAULT_RATE = 5.0             # 既定スループット（req/秒・トークンバケット）
DEFAULT_CONCURRENCY = 4        # 既定 同時リクエスト数
DEFAULT_ZOOM = 12              # 既定ズーム（全国を現実的時間に収めるため z=12）
SUBDIVIDE_THRESHOLD = 150      # base タイルの駅数がこれ以上なら z+1 に細分化
SUBDIVIDE_MAX_ZOOM = 14        # 細分化の上限ズーム

CONDO_TYPE = "中古マンション等"  # XIT001 Type フィールドの値（fetch_realestate.py と同一）
RECENT_QUARTERS = 8            # 直近2年分（8四半期）

PROGRESS_FILE = os.path.join(os.path.dirname(__file__), ".reinfolib_progress.json")

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

# 都道府県の中心緯度経度（PREF_BBOX 未定義時のフォールバック用。census schema と同一）
PREF_CENTER = {
    "01": (43.0642, 141.3469), "02": (40.8244, 140.7400), "03": (39.7036, 141.1527),
    "04": (38.2688, 140.8721), "05": (39.7186, 140.1024), "06": (38.2404, 140.3633),
    "07": (37.7503, 140.4676), "08": (36.3418, 140.4468), "09": (36.5657, 139.8836),
    "10": (36.3907, 139.0604), "11": (35.8570, 139.6489), "12": (35.6051, 140.1233),
    "13": (35.6895, 139.6917), "14": (35.4478, 139.6425), "15": (37.9026, 139.0234),
    "16": (36.6953, 137.2113), "17": (36.5947, 136.6256), "18": (36.0652, 136.2216),
    "19": (35.6642, 138.5684), "20": (36.6513, 138.1810), "21": (35.3912, 136.7223),
    "22": (34.9769, 138.3831), "23": (35.1802, 136.9066), "24": (34.7303, 136.5086),
    "25": (35.0045, 135.8686), "26": (35.0211, 135.7556), "27": (34.6863, 135.5200),
    "28": (34.6913, 135.1830), "29": (34.6851, 135.8328), "30": (34.2261, 135.1675),
    "31": (35.5036, 134.2383), "32": (35.4723, 133.0505), "33": (34.6618, 133.9344),
    "34": (34.3966, 132.4596), "35": (34.1859, 131.4714), "36": (34.0658, 134.5593),
    "37": (34.3401, 134.0434), "38": (33.8416, 132.7657), "39": (33.5597, 133.5311),
    "40": (33.6064, 130.4181), "41": (33.2494, 130.2988), "42": (32.7448, 129.8737),
    "43": (32.7898, 130.7417), "44": (33.2382, 131.6126), "45": (31.9111, 131.4239),
    "46": (31.5602, 130.5581), "47": (26.2124, 127.6809),
}

BBOX_PAD_DEG = 1.0  # PREF_BBOX 未定義時の中心±度（フォールバック）

# 都道府県バウンディングボックス（南西lat, 南西lng, 北東lat, 北東lng）。
#   鉄道路線が存在する陸域を覆う実データ寄りの範囲（海上・無人地帯のタイルを削減）。
#   離島で鉄道の無い地域（奄美・対馬・隠岐・佐渡・小笠原 等）は意図的に除外。
#   ※ rectangular bbox のため多少の海域は含むが、±1.2°暫定値より大幅にタイト。
#   TODO(bbox): 取りこぼしが判明した県は範囲を広げて差し替えること。
PREF_BBOX = {
    "01": (41.35, 139.70, 45.55, 145.85),  # 北海道（本島の鉄道域）
    "02": (40.20, 139.45, 41.60, 141.70),  # 青森
    "03": (38.70, 140.65, 40.50, 142.10),  # 岩手
    "04": (37.75, 140.25, 39.00, 141.70),  # 宮城
    "05": (38.85, 139.65, 40.55, 140.95),  # 秋田
    "06": (37.70, 139.50, 39.20, 140.65),  # 山形
    "07": (36.75, 139.15, 37.95, 141.10),  # 福島
    "08": (35.70, 139.65, 36.95, 140.85),  # 茨城
    "09": (36.20, 139.30, 37.20, 140.30),  # 栃木
    "10": (35.95, 138.40, 37.10, 139.70),  # 群馬
    "11": (35.70, 138.70, 36.30, 139.95),  # 埼玉
    "12": (34.90, 139.70, 36.10, 140.90),  # 千葉
    "13": (35.50, 138.90, 35.90, 139.95),  # 東京（本土。伊豆/小笠原諸島は鉄道なし→除外）
    "14": (35.10, 138.90, 35.70, 139.80),  # 神奈川
    "15": (36.70, 137.55, 38.55, 139.95),  # 新潟（佐渡は鉄道なし→除外）
    "16": (36.25, 136.75, 37.00, 137.80),  # 富山
    "17": (36.00, 136.20, 37.60, 137.40),  # 石川（能登半島）
    "18": (35.30, 135.40, 36.30, 136.55),  # 福井
    "19": (35.15, 138.20, 35.95, 139.15),  # 山梨
    "20": (35.15, 137.30, 37.05, 138.75),  # 長野
    "21": (35.15, 136.25, 36.55, 137.65),  # 岐阜
    "22": (34.55, 137.45, 35.70, 139.20),  # 静岡
    "23": (34.55, 136.65, 35.45, 137.85),  # 愛知
    "24": (33.70, 135.80, 35.30, 136.95),  # 三重
    "25": (34.75, 135.75, 35.70, 136.45),  # 滋賀
    "26": (34.70, 134.80, 35.80, 136.10),  # 京都
    "27": (34.25, 135.05, 35.05, 135.75),  # 大阪
    "28": (34.15, 134.20, 35.70, 135.50),  # 兵庫（淡路は鉄道なし→除外）
    "29": (33.85, 135.60, 34.80, 136.15),  # 奈良
    "30": (33.40, 134.95, 34.35, 135.80),  # 和歌山
    "31": (35.05, 133.10, 35.65, 134.50),  # 鳥取
    "32": (34.30, 131.60, 35.65, 133.45),  # 島根（隠岐は鉄道なし→除外）
    "33": (34.25, 133.25, 35.40, 134.45),  # 岡山
    "34": (34.00, 131.95, 35.10, 133.55),  # 広島
    "35": (33.70, 130.75, 34.85, 132.45),  # 山口
    "36": (33.50, 133.55, 34.35, 134.85),  # 徳島
    "37": (34.00, 133.45, 34.60, 134.50),  # 香川
    "38": (32.90, 132.00, 34.35, 133.75),  # 愛媛
    "39": (32.70, 132.45, 33.95, 134.35),  # 高知
    "40": (33.00, 129.95, 34.05, 131.05),  # 福岡
    "41": (32.90, 129.70, 33.65, 130.55),  # 佐賀
    "42": (32.55, 128.55, 34.75, 130.45),  # 長崎（対馬/壱岐は鉄道なし→実質除外）
    "43": (32.10, 130.00, 33.25, 131.35),  # 熊本
    "44": (32.70, 130.75, 33.75, 132.10),  # 大分
    "45": (31.30, 130.65, 32.85, 131.95),  # 宮崎
    "46": (31.00, 130.10, 32.20, 131.20),  # 鹿児島（本土。奄美は鉄道なし→除外）
    "47": (26.10, 127.60, 26.40, 128.00),  # 沖縄（ゆいレール／那覇近辺）
}


# ── トークンバケット型レート制限 ──────────────────────────────
class RateLimiter:
    """全スレッド共有のトークンバケット。1リクエスト=1トークンを消費。"""

    def __init__(self, rate: float, burst: float):
        self.rate = rate
        self.capacity = max(1.0, burst)
        self.tokens = self.capacity
        self.last = time.monotonic()
        self.lock = threading.Lock()

    def acquire(self) -> None:
        while True:
            with self.lock:
                now = time.monotonic()
                self.tokens = min(self.capacity, self.tokens + (now - self.last) * self.rate)
                self.last = now
                if self.tokens >= 1.0:
                    self.tokens -= 1.0
                    return
                wait = (1.0 - self.tokens) / self.rate
            time.sleep(wait)


# ── HTTP（スレッドローカル Session・429/5xx 対応・gzip）─────────
_thread_local = threading.local()


def _session() -> requests.Session:
    s = getattr(_thread_local, "session", None)
    if s is None:
        s = requests.Session()
        _thread_local.session = s
    return s


def _decode_json(resp: requests.Response):
    """gzip を考慮して JSON を返す。requests は自動解凍するが明示的に対応する。"""
    if resp.headers.get("Content-Encoding", "").lower() == "gzip":
        try:
            return json.loads(gzip.decompress(resp.content).decode("utf-8"))
        except (OSError, ValueError):
            pass  # requests が既に解凍済みなら content は平文。下の resp.json() に委ねる。
    return resp.json()


def api_get(url: str, params: dict, api_key: str, limiter: RateLimiter) -> dict | None:
    """REINFOLIB ex-api への GET。レート制限・指数バックオフ・429待機・gzip 対応。"""
    headers = {"Ocp-Apim-Subscription-Key": api_key, "Accept-Encoding": "gzip"}
    attempt = 0
    n_429 = 0
    while attempt < MAX_RETRIES:
        limiter.acquire()
        try:
            resp = _session().get(url, params=params, headers=headers, timeout=REQUEST_TIMEOUT)
            if resp.status_code == 429:
                n_429 += 1
                if n_429 > MAX_429:
                    log.warning(f"  429 が継続。打ち切り: {url} {params}")
                    return None
                ra = resp.headers.get("Retry-After", "")
                wait = float(ra) if ra.replace(".", "", 1).isdigit() else RATE_429_WAIT
                log.warning(f"  429 レート制限。{wait:.0f}s 待機して再試行…")
                time.sleep(wait)
                continue  # 429 はリトライ回数を消費しない
            if 400 <= resp.status_code < 500:
                # クライアントエラー（例: 未公表四半期の XIT001 など）はリトライ不要・即返す
                log.debug(f"  {resp.status_code} スキップ: {url} {params}")
                return None
            if 500 <= resp.status_code < 600:
                raise requests.HTTPError(f"HTTP {resp.status_code}")
            resp.raise_for_status()
            return _decode_json(resp)
        except (requests.RequestException, ValueError) as e:
            wait = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
            log.debug(f"  retry {attempt + 1}/{MAX_RETRIES} ({url} {params}): {e} → sleep {wait}s")
            attempt += 1
            if attempt < MAX_RETRIES:
                time.sleep(wait)
    log.warning(f"  リクエスト失敗（{MAX_RETRIES}回）: {url} {params}")
    return None


# ── ユーティリティ ──────────────────────────────────────────
def to_number(value) -> float | None:
    if value in (None, "", "-", "*"):
        return None
    try:
        return float(str(value).replace(",", "").replace("円", "").strip())
    except (ValueError, TypeError):
        return None


def haversine_km(lat1, lng1, lat2, lng2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlng / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def recent_year_quarters(now_year: int, now_quarter: int, n: int) -> list[tuple[int, int]]:
    """(now_year, now_quarter) を含めて直近 n 四半期を古い順に返す。"""
    out: list[tuple[int, int]] = []
    y, q = now_year, now_quarter
    for _ in range(n):
        out.append((y, q))
        q -= 1
        if q == 0:
            q = 4
            y -= 1
    return sorted(out)


def fmt_duration(seconds: float) -> str:
    seconds = int(max(0, seconds))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}時間{m}分"
    if m:
        return f"{m}分{s}秒"
    return f"{s}秒"


# ── タイル座標（標準 Web メルカトル XYZ）────────────────────
def deg2tile(lat_deg: float, lon_deg: float, z: int) -> tuple[int, int]:
    lat_rad = math.radians(lat_deg)
    n = 2 ** z
    x = int((lon_deg + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return x, y


def build_bbox(pref_code: str) -> tuple[float, float, float, float]:
    """都道府県の (sw_lat, sw_lng, ne_lat, ne_lng) を返す。"""
    if pref_code in PREF_BBOX:
        return PREF_BBOX[pref_code]
    clat, clng = PREF_CENTER[pref_code]
    # TODO(bbox): PREF_BBOX 未定義の暫定値。実測 bbox を PREF_BBOX に追加すること。
    return (clat - BBOX_PAD_DEG, clng - BBOX_PAD_DEG,
            clat + BBOX_PAD_DEG, clng + BBOX_PAD_DEG)


def tiles_for_bbox(bbox: tuple[float, float, float, float], z: int) -> list[tuple[int, int]]:
    sw_lat, sw_lng, ne_lat, ne_lng = bbox
    x1, y1 = deg2tile(ne_lat, sw_lng, z)   # 北西（y は緯度大で小）
    x2, y2 = deg2tile(sw_lat, ne_lng, z)   # 南東
    x_min, x_max = sorted((x1, x2))
    y_min, y_max = sorted((y1, y2))
    return [(x, y) for x in range(x_min, x_max + 1) for y in range(y_min, y_max + 1)]


def child_tiles(x: int, y: int) -> list[tuple[int, int]]:
    """(x, y, z) の z+1 子タイル4枚を返す。"""
    return [(2 * x, 2 * y), (2 * x + 1, 2 * y), (2 * x, 2 * y + 1), (2 * x + 1, 2 * y + 1)]


def estimate_tiles(pref_codes: list[str], z: int) -> int:
    return sum(len(tiles_for_bbox(build_bbox(pc), z)) for pc in pref_codes)


# ── (A) XIT001: マンション取引履歴 ──────────────────────────
def fetch_xit001_transactions(api_key: str, pref_code: str,
                              years_quarters: list[tuple[int, int]],
                              limiter: RateLimiter) -> list[dict]:
    """指定都道府県の中古マンション等取引を year×quarter で取得。生レコードを返す。"""
    records: list[dict] = []
    for year, quarter in years_quarters:
        params = {"year": year, "quarter": quarter, "area": pref_code,
                  "priceClassification": "01"}
        data = api_get(XIT001_URL, params, api_key, limiter)
        if not data or data.get("status") != "OK":
            continue
        for r in data.get("data", []):
            if CONDO_TYPE in (r.get("Type") or ""):
                r["_year"] = year
                r["_quarter"] = quarter
                records.append(r)
    return records


def aggregate_mansion_by_city(records: list[dict]) -> dict[tuple[str, int, int], dict]:
    """中古マンション取引を (city_code, year, quarter) で集計。"""
    buckets: dict[tuple[str, int, int], dict] = defaultdict(
        lambda: {"prices": [], "per_sqm": [], "areas": []}
    )
    for r in records:
        city_code = (r.get("MunicipalityCode") or "").strip()
        # 都道府県コード 01〜09 は API の MunicipalityCode が 4 桁（先頭ゼロ欠落、
        # 例: 札幌市中央区 "1101"）で返るため 5 桁ゼロ埋めで JIS コードに補完する。
        if city_code:
            city_code = city_code.zfill(5)
        if not (len(city_code) == 5 and city_code.isdigit()):
            continue
        key = (city_code, int(r["_year"]), int(r["_quarter"]))
        price = to_number(r.get("TradePrice"))
        area = to_number(r.get("Area"))
        unit = to_number(r.get("UnitPrice"))
        b = buckets[key]
        if price is not None and price > 0:
            b["prices"].append(price / 10_000)
        if unit is not None and unit > 0:
            b["per_sqm"].append(unit / 10_000)
        elif price and area and price > 0 and area > 0:
            b["per_sqm"].append((price / 10_000) / area)
        if area is not None and area > 0:
            b["areas"].append(area)

    result: dict[tuple[str, int, int], dict] = {}
    for key, b in buckets.items():
        count = max(len(b["prices"]), len(b["areas"]), len(b["per_sqm"]))
        if count == 0:
            continue
        result[key] = {
            "transaction_count": count,
            "avg_price_man_yen": round(sum(b["prices"]) / len(b["prices"]), 1) if b["prices"] else None,
            "avg_price_per_sqm": round(sum(b["per_sqm"]) / len(b["per_sqm"]), 3) if b["per_sqm"] else None,
            "avg_area_sqm": round(sum(b["areas"]) / len(b["areas"]), 1) if b["areas"] else None,
        }
    return result


# ── (B) XKT015: 駅別乗降客数 ────────────────────────────────
# 乗降客数の年次列（新しい順）。S12_057=2023、以降 4 ずつ減って 1 年前。
PASSENGER_COLS = [(2023 - k, f"S12_{57 - 4 * k:03d}") for k in range(0, 11)]  # 2023..2013


def _latest_passengers(props: dict) -> tuple[int | None, int | None]:
    """最新の乗降客数とその年を返す。2023→2022→… の順でフォールバック。"""
    for year, col in PASSENGER_COLS:
        val = to_number(props.get(col))
        if val is not None and val > 0:
            return int(round(val)), year
    return None, None


def _centroid_lnglat(coords) -> tuple[float | None, float | None]:
    """任意の GeoJSON geometry 座標から代表点 (lng, lat) を求める。

    Point は [lng, lat]、LineString/MultiPoint は [[lng, lat], ...]、Polygon は
    さらに入れ子。駅は路線上の線分や複数点で表現される場合があるため、含まれる
    全ての数値ペアの重心を代表点として返す。
    """
    pts: list[tuple[float, float]] = []

    def rec(c) -> None:
        if isinstance(c, (list, tuple)):
            if (len(c) >= 2 and isinstance(c[0], (int, float))
                    and isinstance(c[1], (int, float))):
                pts.append((float(c[0]), float(c[1])))
            else:
                for x in c:
                    rec(x)

    rec(coords)
    if not pts:
        return None, None
    lng = sum(p[0] for p in pts) / len(pts)
    lat = sum(p[1] for p in pts) / len(pts)
    return lng, lat


def _parse_feature(by_group: dict, feature: dict, pref_code: str) -> None:
    """1 feature を解析して by_group[group_code] に格納（重複は良い方を優先）。"""
    props = feature.get("properties") or {}
    geom = feature.get("geometry") or {}
    name = (props.get("S12_001_ja") or "").strip()
    if not name:
        return
    group_code = (props.get("S12_001g") or props.get("S12_001c") or "").strip()
    if not group_code:
        group_code = f"{name}|{props.get('S12_003_ja', '')}"
    passengers, pyear = _latest_passengers(props)
    lng, lat = _centroid_lnglat(geom.get("coordinates"))
    existing = by_group.get(group_code)
    if existing and existing.get("passengers_latest") is not None and passengers is None:
        return
    by_group[group_code] = {
        "prefecture_code": pref_code,
        "station_code": (props.get("S12_001c") or "").strip() or None,
        "group_code": group_code,
        "name": name,
        "operator": (props.get("S12_002_ja") or "").strip() or None,
        "line_name": (props.get("S12_003_ja") or "").strip() or None,
        "passengers_latest": passengers,
        "passengers_year": pyear,
        "lat": lat,
        "lng": lng,
    }


def _fetch_tile_features(x: int, y: int, z: int, api_key: str, limiter: RateLimiter) -> list:
    data = api_get(XKT015_URL, {"response_format": "geojson", "z": z, "x": x, "y": y},
                   api_key, limiter)
    if not data:
        return []
    return data.get("features") or []


def fetch_tiles_parallel(tiles: list[tuple[int, int]], z: int, api_key: str,
                         limiter: RateLimiter, concurrency: int,
                         on_done=None) -> dict[tuple[int, int], list]:
    """タイル群を並列取得。{(x,y): features} を返す。"""
    results: dict[tuple[int, int], list] = {}
    if not tiles:
        return results
    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        futs = {ex.submit(_fetch_tile_features, x, y, z, api_key, limiter): (x, y)
                for (x, y) in tiles}
        for fut in as_completed(futs):
            xy = futs[fut]
            try:
                results[xy] = fut.result()
            except Exception as e:  # noqa: BLE001
                log.debug(f"  タイル {xy} 取得失敗: {e}")
                results[xy] = []
            if on_done:
                on_done()
    return results


def fetch_xkt015_stations(api_key: str, pref_code: str, z: int, limiter: RateLimiter,
                          concurrency: int, subdivide: bool = True,
                          on_tile=None) -> list[dict]:
    """都道府県 bbox を並列タイル走査して駅を取得。group_code で重複排除して返す。

    subdivide=True のとき、駅密度の高い base タイルのみ z+1 子タイルを追加取得して
    取りこぼし（タイルあたり件数上限による切り捨て）を防ぐ。
    """
    bbox = build_bbox(pref_code)
    base_tiles = tiles_for_bbox(bbox, z)
    log.info(f"    XKT015: bbox={tuple(round(v, 2) for v in bbox)} z={z} → {len(base_tiles)} タイル並列走査")

    base = fetch_tiles_parallel(base_tiles, z, api_key, limiter, concurrency, on_done=on_tile)

    by_group: dict[str, dict] = {}
    dense: list[tuple[int, int]] = []
    nonempty = 0
    for (x, y), feats in base.items():
        if feats:
            nonempty += 1
        for f in feats:
            _parse_feature(by_group, f, pref_code)
        if subdivide and len(feats) >= SUBDIVIDE_THRESHOLD and z < SUBDIVIDE_MAX_ZOOM:
            dense.append((x, y))

    # 高密度タイルのみ z+1 で補完（取りこぼし保険・dedup により重複は無害）
    if dense:
        children: list[tuple[int, int]] = []
        for (x, y) in dense:
            children.extend(child_tiles(x, y))
        log.info(f"    XKT015: 高密度 {len(dense)} タイルを z={z + 1} で補完（子 {len(children)} タイル）")
        child = fetch_tiles_parallel(children, z + 1, api_key, limiter, concurrency, on_done=on_tile)
        for feats in child.values():
            for f in feats:
                _parse_feature(by_group, f, pref_code)

    log.info(f"    XKT015: {len(by_group)} 駅（非空タイル {nonempty}/{len(base_tiles)}）")
    return list(by_group.values())


# ── Supabase ───────────────────────────────────────────────
def get_supabase() -> Client:
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL")
    key = (
        os.getenv("SUPABASE_SERVICE_KEY")
        or os.getenv("SUPABASE_SERVICE_ROLE_KEY")        # .env.local の実際の変数名
        or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    )
    if not url or not key:
        raise ValueError("Supabase の接続情報が見つかりません (.env.local)")
    return create_client(url, key)


def load_municipalities(sb: Client) -> dict[str, list[dict]]:
    """都道府県コード → [{id, city_code, name, lat, lng}] を構築（全件）。"""
    by_pref: dict[str, list[dict]] = defaultdict(list)
    offset = 0
    while True:
        res = (
            sb.table("municipalities")
            .select("id, prefecture_code, city_code, name, lat, lng")
            .range(offset, offset + 999)
            .execute()
        )
        rows = res.data or []
        for m in rows:
            by_pref[m["prefecture_code"]].append(m)
        if len(rows) < 1000:
            break
        offset += 1000
    return by_pref


def make_city_resolver(munis: list[dict]):
    """駅座標 (lat,lng) → 最近傍 municipality_id を返すリゾルバ（近似）。"""
    with_coords = [m for m in munis if m.get("lat") is not None and m.get("lng") is not None]

    def resolve(lat, lng) -> str | None:
        if lat is None or lng is None or not with_coords:
            return None
        best, best_d = None, float("inf")
        for m in with_coords:
            d = haversine_km(lat, lng, m["lat"], m["lng"])
            if d < best_d:
                best, best_d = m, d
        return best["id"] if best else None

    return resolve


def upsert_transactions(sb: Client, rows: list[dict]) -> None:
    CHUNK = 500
    for i in range(0, len(rows), CHUNK):
        sb.table("real_estate_transactions").upsert(
            rows[i:i + CHUNK], on_conflict="city_code,year,quarter"
        ).execute()


def upsert_stations(sb: Client, rows: list[dict]) -> None:
    CHUNK = 500
    for i in range(0, len(rows), CHUNK):
        sb.table("stations").upsert(
            rows[i:i + CHUNK], on_conflict="group_code"
        ).execute()


def update_station_aggregates(sb: Client, totals: dict[str, int]) -> None:
    """municipalities.station_passengers_total を市区町村ごとに更新。"""
    for muni_id, total in totals.items():
        sb.table("municipalities").update(
            {"station_passengers_total": int(total)}
        ).eq("id", muni_id).execute()


# ── レジューム（進捗ファイル）──────────────────────────────
def load_progress(reset: bool) -> dict:
    if reset and os.path.exists(PROGRESS_FILE):
        os.remove(PROGRESS_FILE)
        log.info(f"レジューム記録を破棄しました: {PROGRESS_FILE}")
    if os.path.exists(PROGRESS_FILE):
        try:
            with open(PROGRESS_FILE, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            log.warning("進捗ファイルが読めません。新規作成します。")
    return {"completed": [], "zoom": None, "updated_at": None}


def save_progress(progress: dict) -> None:
    progress["updated_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
    try:
        with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
            json.dump(progress, f, ensure_ascii=False, indent=2)
    except OSError as e:
        log.warning(f"進捗ファイル書き込み失敗: {e}")


# ── 1県分の処理 ────────────────────────────────────────────
def process_prefecture(sb: Client | None, api_key: str, pref_code: str, munis: list[dict],
                       years_quarters: list[tuple[int, int]], z: int, limiter: RateLimiter,
                       concurrency: int, subdivide: bool, do_tx: bool, do_st: bool,
                       dry_run: bool, on_tile=None) -> dict:
    pref_name = PREF_NAMES[pref_code]
    id_by_code = {m["city_code"]: m["id"] for m in munis}
    resolve_city = make_city_resolver(munis)
    summary = {"tx_rows": 0, "stations": 0, "stations_unlinked": 0, "muni_updated": 0}

    # ── (A) マンション取引 → real_estate_transactions ──
    if do_tx:
        records = fetch_xit001_transactions(api_key, pref_code, years_quarters, limiter)
        aggregated = aggregate_mansion_by_city(records)
        tx_rows: list[dict] = []
        for (city_code, year, quarter), v in aggregated.items():
            tx_rows.append({
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
        log.info(f"    XIT001: {len(records)} 取引 → {len(tx_rows)} 集計行（市区町村×四半期）")
        if tx_rows and not dry_run:
            upsert_transactions(sb, tx_rows)
        summary["tx_rows"] = len(tx_rows)

    # ── (B) 駅 → stations ＋ 集約 ──
    if do_st:
        stations = fetch_xkt015_stations(api_key, pref_code, z, limiter, concurrency,
                                         subdivide=subdivide, on_tile=on_tile)
        totals: dict[str, int] = defaultdict(int)
        unlinked = 0
        for s in stations:
            muni_id = resolve_city(s["lat"], s["lng"])
            s["municipality_id"] = muni_id
            if muni_id is None:
                unlinked += 1
            elif s["passengers_latest"]:
                totals[muni_id] += s["passengers_latest"]
        if unlinked:
            log.warning(f"    {unlinked}/{len(stations)} 駅が市区町村に紐付きません（municipality_id=NULL）")
        if not dry_run:
            if stations:
                upsert_stations(sb, stations)
            if totals:
                update_station_aggregates(sb, totals)
        summary["stations"] = len(stations)
        summary["stations_unlinked"] = unlinked
        summary["muni_updated"] = len(totals)

    log.info(
        f"  ✓ {pref_name}: 取引 {summary['tx_rows']} 行 / 駅 {summary['stations']} 件 "
        f"（未紐付 {summary['stations_unlinked']}）/ 集約更新 {summary['muni_updated']} 市区町村"
    )
    return summary


# ── compare-zoom（取りこぼし検証）──────────────────────────
def run_compare_zoom(api_key: str, pref_code: str, limiter: RateLimiter, concurrency: int) -> None:
    pref_name = PREF_NAMES[pref_code]
    log.info("=" * 64)
    log.info(f"ズーム比較（取りこぼし検証）: {pref_code} {pref_name}")
    log.info("z=12 / z=13 を各々 単一ズーム（細分化なし）で取得し駅数を比較します。")
    log.info("=" * 64)

    st12 = fetch_xkt015_stations(api_key, pref_code, 12, limiter, concurrency, subdivide=False)
    st13 = fetch_xkt015_stations(api_key, pref_code, 13, limiter, concurrency, subdivide=False)
    g12 = {s["group_code"] for s in st12}
    g13 = {s["group_code"] for s in st13}
    only13 = g13 - g12
    only12 = g12 - g13
    base = max(len(g13), 1)

    log.info("-" * 64)
    log.info(f"z=12 駅数: {len(g12)}")
    log.info(f"z=13 駅数: {len(g13)}")
    log.info(f"z=13 のみ（z=12 で取りこぼし）: {len(only13)} 駅  → 取りこぼし率 {100 * len(only13) / base:.1f}%")
    log.info(f"z=12 のみ（z=13 に無い）: {len(only12)} 駅")
    if only13:
        names = sorted({f"{s['name']}({s['line_name']})" for s in st13 if s["group_code"] in only13})
        log.info("z=12 で取りこぼした駅（例・最大20件）: " + " / ".join(names[:20]))
    log.info("-" * 64)
    log.info("判断材料: 取りこぼし率が許容範囲なら z=12 既定で全国走査。"
             "高ければ --zoom 13、または既定の自動細分化（subdivide）で吸収されます。")
    log.info("=" * 64)


# ── メイン ─────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(description="REINFOLIB 連携収集（XIT001 取引 / XKT015 駅）")
    parser.add_argument("--pref", default="46",
                        help="対象都道府県コード2桁（既定: 46 鹿児島）。--all 指定時は無視。")
    parser.add_argument("--all", action="store_true",
                        help="全国47都道府県を走査（推定表示→確認→実行。レジューム対応）。")
    parser.add_argument("--zoom", type=int, default=DEFAULT_ZOOM,
                        help=f"XKT015 タイルズーム（11〜15、既定 {DEFAULT_ZOOM}）。")
    parser.add_argument("--rate", type=float, default=DEFAULT_RATE,
                        help=f"スループット上限 req/秒（既定 {DEFAULT_RATE}）。")
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY,
                        help=f"同時リクエスト数（既定 {DEFAULT_CONCURRENCY}）。")
    parser.add_argument("--no-subdivide", action="store_true",
                        help="高密度タイルの z+1 自動細分化を無効化する。")
    parser.add_argument("--compare-zoom", action="store_true",
                        help="--pref の県で z=12/z=13 の取得駅数を比較（DB 書き込みなし）。")
    parser.add_argument("--skip-transactions", action="store_true", help="XIT001（取引）をスキップ")
    parser.add_argument("--skip-stations", action="store_true", help="XKT015（駅）をスキップ")
    parser.add_argument("--dry-run", action="store_true", help="DB 書き込みなしで取得のみ確認")
    parser.add_argument("--reset", action="store_true", help="レジューム記録を破棄して最初から")
    parser.add_argument("--yes", action="store_true", help="--all の続行確認を省略（自動実行向け）")
    args = parser.parse_args()

    api_key = os.getenv("REINFOLIB_API_KEY", "").strip()
    if not api_key:
        log.error("REINFOLIB_API_KEY が設定されていません (.env.local)。終了します。")
        raise SystemExit(1)

    limiter = RateLimiter(rate=args.rate, burst=max(args.concurrency, args.rate))

    # ── compare-zoom（検証モード）──
    if args.compare_zoom:
        run_compare_zoom(api_key, args.pref.zfill(2), limiter, args.concurrency)
        return

    do_tx = not args.skip_transactions
    do_st = not args.skip_stations
    if not (do_tx or do_st):
        log.error("--skip-transactions と --skip-stations を同時指定すると処理がありません。")
        raise SystemExit(1)

    subdivide = not args.no_subdivide
    all_codes = sorted(PREF_NAMES.keys())
    pref_codes = all_codes if args.all else [args.pref.zfill(2)]
    for pc in pref_codes:
        if pc not in PREF_NAMES:
            log.error(f"不正な都道府県コード: {pc}")
            raise SystemExit(1)

    # ── レジューム: 完了県をスキップ（--all のみ）──
    progress = load_progress(args.reset) if args.all else {"completed": []}
    completed = set(progress.get("completed", []))
    todo = [pc for pc in pref_codes if pc not in completed] if args.all else pref_codes
    if args.all and completed:
        log.info(f"レジューム: 完了済 {len(completed)} 県をスキップ → 残り {len(todo)} 県")

    # 直近 8 四半期（取得元の年・四半期）を算出。
    from datetime import datetime
    now = datetime.now()
    now_q = (now.month - 1) // 3 + 1
    years_quarters = recent_year_quarters(now.year, now_q, RECENT_QUARTERS)

    # ── 推定タイル数・所要時間（駅取得時のみ）と続行確認 ──
    est_tiles = estimate_tiles(todo, args.zoom) if do_st else 0
    # XIT001 リクエスト数（8四半期×県）も全体スループットを消費する
    est_requests = est_tiles + (len(todo) * RECENT_QUARTERS if do_tx else 0)
    est_seconds = est_requests / max(args.rate, 0.1)
    if subdivide and do_st:
        est_seconds *= 1.2  # 高密度タイルの細分化ぶんを概算上乗せ

    log.info("=" * 64)
    log.info("REINFOLIB 連携収集" + ("  [DRY-RUN]" if args.dry_run else ""))
    log.info(f"対象: {'全国' if args.all else PREF_NAMES[pref_codes[0]]} / 残り {len(todo)} 県"
             f" / 取引={do_tx} 駅={do_st}")
    log.info(f"設定: z={args.zoom} 細分化={subdivide} rate={args.rate}req/s 並列={args.concurrency}")
    if do_st:
        log.info(f"推定: base タイル {est_tiles} 枚 / 総リクエスト 約{est_requests} / "
                 f"推定所要 約{fmt_duration(est_seconds)}（細分化・遅延で前後）")
    log.info("=" * 64)

    if args.all and not args.yes:
        try:
            ans = input(f"全国 {len(todo)} 県を走査します（推定 約{fmt_duration(est_seconds)}）。続行しますか? [y/N]: ")
        except EOFError:
            log.error("非対話実行です。--yes を付けて実行してください。")
            raise SystemExit(1)
        if ans.strip().lower() not in ("y", "yes"):
            log.info("中止しました。")
            return

    sb = None if args.dry_run else get_supabase()
    munis_by_pref = load_municipalities(sb if sb else get_supabase())
    log.info(f"市区町村マスタ: {sum(len(v) for v in munis_by_pref.values())} 件")

    # ── 県ごとに処理（1県完了ごとに DB 反映＆進捗記録）──
    run_start = time.monotonic()
    tiles_done = [0]  # ETA 用カウンタ（クロージャで更新）

    def on_tile():
        tiles_done[0] += 1
        done = tiles_done[0]
        if done % 200 == 0 and est_tiles:
            elapsed = time.monotonic() - run_start
            rate_obs = done / max(elapsed, 0.1)
            remain = max(est_tiles - done, 0) / max(rate_obs, 0.1)
            log.info(f"      進捗: {done}/{est_tiles} タイル / 残り推定 約{fmt_duration(remain)}")

    agg = {"tx_rows": 0, "stations": 0, "stations_unlinked": 0, "muni_updated": 0}
    for idx, pc in enumerate(todo, start=1):
        log.info(f"[{idx}/{len(todo)}] {pc} {PREF_NAMES[pc]} 処理中…")
        munis = munis_by_pref.get(pc, [])
        if not munis:
            log.warning(f"  {PREF_NAMES[pc]}: municipalities データなし、スキップ")
            continue
        try:
            s = process_prefecture(sb, api_key, pc, munis, years_quarters, args.zoom,
                                   limiter, args.concurrency, subdivide, do_tx, do_st,
                                   args.dry_run, on_tile=on_tile)
            for k in agg:
                agg[k] += s[k]
            # 完了記録（dry-run では記録しない＝再実行で再取得される）
            if args.all and not args.dry_run:
                completed.add(pc)
                progress["completed"] = sorted(completed)
                progress["zoom"] = args.zoom
                save_progress(progress)
        except Exception as e:  # noqa: BLE001 — 1県の失敗で全体を止めない
            log.error(f"  {PREF_NAMES[pc]}: 失敗（継続）: {e}")
            continue

        if args.all:
            elapsed = time.monotonic() - run_start
            per = elapsed / idx
            log.info(f"  県進捗: {idx}/{len(todo)} 完了 / 経過 {fmt_duration(elapsed)} / "
                     f"残り推定 約{fmt_duration(per * (len(todo) - idx))}")

    log.info("=" * 64)
    log.info(
        f"完了: 取引 {agg['tx_rows']} 行 / 駅 {agg['stations']} 件 "
        f"（未紐付 {agg['stations_unlinked']}）/ 集約更新 {agg['muni_updated']} 市区町村"
        + ("  ※DRY-RUN（DB未更新）" if args.dry_run else "")
    )
    if args.all and not args.dry_run:
        log.info(f"レジューム記録: {len(completed)}/47 県完了（{PROGRESS_FILE}）")
    log.info("=" * 64)


if __name__ == "__main__":
    main()

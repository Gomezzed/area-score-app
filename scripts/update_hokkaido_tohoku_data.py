#!/usr/bin/env python3
"""
北海道・東北地方（北海道・青森・岩手・宮城・秋田・山形・福島）
不動産・人口データ 自動更新スクリプト

取得元:
  - 国土交通省 不動産取引価格情報 API (認証不要)
  - e-Stat 住民基本台帳 API

更新先:
  - Supabase areas テーブル（北海道・東北地方市区町村別）

注意:
  宮城県仙台市は別途 sendai タブで管理するため本スクリプトでは除外しています。

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

PREF_CODES    = ["01", "02", "03", "04", "05", "06", "07"]
PREF_NAME     = "北海道・東北（北海道・青森・岩手・宮城・秋田・山形・福島）"
CITY_NAME_EN  = "hokkaido_tohoku"
SCORE_WEIGHTS = {"transaction": 0.4, "population": 0.3, "price": 0.3}

# 北海道 全市町村（主要自治体）
HOKKAIDO_MUNICIPALITIES = [
    # 市
    "札幌市", "函館市", "小樽市", "旭川市", "室蘭市", "釧路市", "帯広市", "北見市",
    "夕張市", "岩見沢市", "網走市", "留萌市", "苫小牧市", "稚内市", "美唄市", "芦別市",
    "江別市", "赤平市", "紋別市", "士別市", "名寄市", "三笠市", "根室市", "千歳市",
    "滝川市", "砂川市", "歌志内市", "深川市", "富良野市", "登別市", "恵庭市", "伊達市",
    "北広島市", "石狩市", "北斗市",
    # 石狩振興局
    "当別町", "新篠津村",
    # 渡島総合振興局
    "松前町", "福島町", "知内町", "木古内町", "七飯町", "鹿部町", "森町", "八雲町", "長万部町",
    # 檜山振興局
    "江差町", "上ノ国町", "厚沢部町", "乙部町", "奥尻町", "今金町", "せたな町",
    # 後志総合振興局
    "島牧村", "寿都町", "黒松内町", "蘭越町", "ニセコ町", "真狩村", "留寿都村",
    "喜茂別町", "京極町", "倶知安町", "共和町", "岩内町", "泊村", "神恵内村",
    "積丹町", "古平町", "仁木町", "余市町", "赤井川村",
    # 空知総合振興局
    "南幌町", "奈井江町", "上砂川町", "由仁町", "長沼町", "栗山町", "月形町",
    "浦臼町", "新十津川町", "妹背牛町", "秩父別町", "雨竜町", "北竜町", "沼田町",
    # 上川総合振興局
    "鷹栖町", "東神楽町", "当麻町", "比布町", "愛別町", "上川町", "東川町", "美瑛町",
    "上富良野町", "中富良野町", "南富良野町", "占冠村", "和寒町", "剣淵町", "下川町",
    "美深町", "音威子府村", "中川町", "幌加内町",
    # 留萌振興局
    "増毛町", "小平町", "苫前町", "羽幌町", "初山別村", "遠別町", "天塩町",
    # 宗谷総合振興局
    "猿払村", "浜頓別町", "中頓別町", "枝幸町", "豊富町", "礼文町", "利尻町",
    "利尻富士町", "幌延町",
    # オホーツク総合振興局
    "美幌町", "津別町", "斜里町", "清里町", "小清水町", "訓子府町", "置戸町",
    "佐呂間町", "遠軽町", "湧別町", "滝上町", "興部町", "西興部村", "雄武町", "大空町",
    # 胆振総合振興局
    "豊浦町", "壮瞥町", "白老町", "厚真町", "洞爺湖町", "安平町", "むかわ町",
    # 日高振興局
    "日高町", "平取町", "新冠町", "浦河町", "様似町", "えりも町", "新ひだか町",
    # 十勝総合振興局
    "音更町", "士幌町", "上士幌町", "鹿追町", "新得町", "清水町", "芽室町",
    "中札内村", "更別村", "大樹町", "広尾町", "幕別町", "池田町", "豊頃町",
    "本別町", "足寄町", "陸別町", "浦幌町",
    # 釧路総合振興局
    "釧路町", "厚岸町", "浜中町", "標茶町", "弟子屈町", "鶴居村", "白糠町",
    # 根室振興局
    "別海町", "中標津町", "標津町", "羅臼町",
]

# 青森県 全40市町村
AOMORI_MUNICIPALITIES = [
    "青森市", "弘前市", "八戸市", "黒石市", "五所川原市", "十和田市", "三沢市",
    "むつ市", "つがる市", "平川市",
    "平内町", "今別町", "蓬田村", "外ヶ浜町", "鰺ヶ沢町", "深浦町", "西目屋村",
    "藤崎町", "大鰐町", "田舎館村", "板柳町", "鶴田町", "中泊町", "野辺地町",
    "七戸町", "六戸町", "横浜町", "東北町", "六ヶ所村", "おいらせ町",
    "大間町", "東通村", "風間浦村", "佐井村",
    "三戸町", "五戸町", "田子町", "南部町", "階上町", "新郷村",
]

# 岩手県 全33市町村
IWATE_MUNICIPALITIES = [
    "盛岡市", "宮古市", "大船渡市", "花巻市", "北上市", "久慈市", "遠野市",
    "一関市", "陸前高田市", "釜石市", "二戸市", "八幡平市", "奥州市", "滝沢市",
    "雫石町", "葛巻町", "岩手町", "紫波町", "矢巾町",
    "西和賀町", "金ケ崎町", "平泉町", "住田町", "大槌町", "山田町",
    "岩泉町", "田野畑村", "普代村", "軽米町", "野田村", "九戸村", "洋野町", "一戸町",
]

# 宮城県 全35市町村（仙台市は sendai タブで管理するため除外）
MIYAGI_MUNICIPALITIES = [
    "石巻市", "塩竈市", "気仙沼市", "白石市", "名取市", "角田市", "多賀城市",
    "岩沼市", "登米市", "栗原市", "東松島市", "大崎市", "富谷市",
    "蔵王町", "七ヶ宿町", "大河原町", "村田町", "柴田町", "川崎町", "丸森町",
    "亘理町", "山元町", "松島町", "七ヶ浜町", "利府町",
    "大和町", "大郷町", "大衡村", "色麻町", "加美町",
    "涌谷町", "美里町", "女川町", "南三陸町",
]

# 秋田県 全25市町村
AKITA_MUNICIPALITIES = [
    "秋田市", "能代市", "横手市", "大館市", "男鹿市", "湯沢市", "鹿角市",
    "由利本荘市", "潟上市", "大仙市", "北秋田市", "にかほ市", "仙北市",
    "小坂町", "上小阿仁村", "藤里町", "三種町", "八峰町",
    "五城目町", "八郎潟町", "井川町", "大潟村",
    "美郷町", "羽後町", "東成瀬村",
]

# 山形県 全35市町村
YAMAGATA_MUNICIPALITIES = [
    "山形市", "米沢市", "鶴岡市", "酒田市", "新庄市", "寒河江市", "上山市",
    "村山市", "長井市", "天童市", "東根市", "尾花沢市", "南陽市",
    "山辺町", "中山町", "河北町", "西川町", "朝日町", "大江町", "大石田町",
    "金山町", "最上町", "舟形町", "真室川町", "大蔵村", "鮭川村", "戸沢村",
    "高畠町", "川西町", "小国町", "白鷹町", "飯豊町",
    "三川町", "庄内町", "遊佐町",
]

# 福島県 全59市町村
FUKUSHIMA_MUNICIPALITIES = [
    "福島市", "会津若松市", "郡山市", "いわき市", "白河市", "須賀川市", "喜多方市",
    "相馬市", "二本松市", "田村市", "南相馬市", "伊達市", "本宮市",
    "桑折町", "国見町", "川俣町", "大玉村", "鏡石町", "天栄村",
    "下郷町", "檜枝岐村", "只見町", "南会津町",
    "北塩原村", "西会津町", "磐梯町", "猪苗代町",
    "会津坂下町", "湯川村", "柳津町", "三島町", "金山町", "昭和村", "会津美里町",
    "西郷村", "泉崎村", "中島村", "矢吹町", "棚倉町", "矢祭町", "塙町", "鮫川村",
    "石川町", "玉川村", "平田村", "浅川町", "古殿町", "三春町", "小野町",
    "広野町", "楢葉町", "富岡町", "川内村", "大熊町", "双葉町", "浪江町",
    "葛尾村", "新地町", "飯舘村",
]

ALL_MUNICIPALITIES = (
    HOKKAIDO_MUNICIPALITIES +
    AOMORI_MUNICIPALITIES +
    IWATE_MUNICIPALITIES +
    MIYAGI_MUNICIPALITIES +
    AKITA_MUNICIPALITIES +
    YAMAGATA_MUNICIPALITIES +
    FUKUSHIMA_MUNICIPALITIES
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
        "name":       "北海道・東北",
        "name_en":    CITY_NAME_EN,
        "center_lat": 40.5,
        "center_lng": 141.0,
        "zoom_level": 6,
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
    log.info(f"北海道・東北データ更新スクリプト 開始: {datetime.now().isoformat()}")
    log.info(
        f"対象: 北海道 {len(HOKKAIDO_MUNICIPALITIES)} + "
        f"青森 {len(AOMORI_MUNICIPALITIES)} + "
        f"岩手 {len(IWATE_MUNICIPALITIES)} + "
        f"宮城(仙台除く) {len(MIYAGI_MUNICIPALITIES)} + "
        f"秋田 {len(AKITA_MUNICIPALITIES)} + "
        f"山形 {len(YAMAGATA_MUNICIPALITIES)} + "
        f"福島 {len(FUKUSHIMA_MUNICIPALITIES)} 市区町村"
    )
    log.info("=" * 60)

    estat_api_key = os.getenv("ESTAT_API_KEY", "")
    if not estat_api_key:
        log.error("ESTAT_API_KEY が設定されていません")
        sys.exit(1)

    quarters = recent_quarters(FETCH_QUARTERS)
    log.info(f"取得対象四半期: {quarters}")

    # 1. 各都道府県の MLIT・人口データを取得・結合
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

    # 2. 全市区町村をカバー（MLIT データがない自治体はゼロ埋め）
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

    # 3. スコア計算
    areas_scored = compute_scores(areas_raw)
    log.info("── スコア上位5エリア ──")
    for a in sorted(areas_scored, key=lambda x: x["score"], reverse=True)[:5]:
        log.info(
            f"  {a['name']:12s} | score={a['score']:5.1f} | tier={a['tier']} | "
            f"txn={a['transaction_count']:4d} | pop={a['population_delta']:+.2f}% | "
            f"price={a['avg_price_level']:.1f}万円/㎡"
        )

    # 4. Supabase 更新
    sb = get_supabase_client()
    city_id = ensure_city(sb)
    upsert_areas(sb, city_id, areas_scored)

    log.info("=" * 60)
    log.info(f"完了: {datetime.now().isoformat()}")
    log.info("=" * 60)


if __name__ == "__main__":
    main()

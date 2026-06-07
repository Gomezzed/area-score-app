#!/usr/bin/env python3
"""
=============================================================================
 build_young_family_inflow.py
 ── 町丁目別「若返り・ファミリー流入」スコアリング バッチスクリプト
=============================================================================
配置先  : scripts/build_young_family_inflow.py
タスク  : #1.5 (国勢調査マスター投入) ＋ #6 (若返り自動スコアリング)

データソース:
  e-Stat API 3.0 - 国勢調査 小地域集計 (男女・年齢別人口および世帯数)
    https://www.e-stat.go.jp/api/

処理フロー:
  1. cities テーブルから対象都市 (name_en) を解決
  2. 基準年 (--base-year, 既定 2015) と比較年 (--target-year, 既定 2020) について
     e-Stat 小地域統計を取得 → towns マスターと town_population_snapshots を upsert
  3. scoring_config からしきい値・内部重みをロード
  4. 各町丁目で base→target のデモグラフィック差分を計算
       - 人口増減 (絶対値・%)
       - 世帯数増減
       - ファミリー指数 = 人口増 − 世帯増
       - 20-49歳 (ファミリー世代) 増減
       - inflow_score (連続値 0-100)
       - is_young_family_inflow (boolean フラグ)
  5. town_demographics に upsert

環境変数 (.env.local):
  ESTAT_API_KEY        - e-Stat APIキー (必須)
  SUPABASE_URL         - Supabase プロジェクトURL
  SUPABASE_SERVICE_KEY - サービスロールキー (RLS bypass)

使用例:
  # 鹿児島市 (pref_code=46) の 2015→2020 比較を実行
  python scripts/build_young_family_inflow.py --city kagoshima --pref-code 46

  # e-Stat 取得をスキップし、既存snapshot から再計算のみ
  python scripts/build_young_family_inflow.py --city kagoshima --pref-code 46 --skip-fetch

⚠️ STATS_DATA_IDS について:
  e-Stat の小地域統計は都道府県ごとに statsDataId が分かれています。
  下記の辞書はテンプレートのため、運用開始時に
  https://www.e-stat.go.jp/dbview の検索結果から実IDを確認・置き換えてください。
=============================================================================
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import sys
import time
from collections import defaultdict
from dataclasses import asdict, dataclass
from typing import Optional

import requests
from dotenv import load_dotenv
from supabase import Client, create_client

# ----------------------------------------------------------------------------
# 設定
# ----------------------------------------------------------------------------
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env.local"))

ESTAT_BASE      = "https://api.e-stat.go.jp/rest/3.0/app/json"
REQUEST_TIMEOUT = 60
RETRY_WAIT      = 3
MAX_RETRY       = 3
UPSERT_BATCH    = 500

DEFAULT_BASE_YEAR   = 2015
DEFAULT_TARGET_YEAR = 2020

# 5歳階級コード → DB 世代区分カラムへのマッピング
# (e-Stat 国勢調査 小地域集計の標準コード仕様。統計表により若干異なる場合あり)
AGE_BUCKET_MAP = {
    "00100": "age_0_14",   "00200": "age_0_14",   "00300": "age_0_14",     # 0-14歳
    "00400": "age_15_19",                                                   # 15-19歳
    "00500": "age_20_29",  "00600": "age_20_29",                            # 20-29歳
    "00700": "age_30_39",  "00800": "age_30_39",                            # 30-39歳
    "00900": "age_40_49",  "01000": "age_40_49",                            # 40-49歳
    "01100": "age_50_64",  "01200": "age_50_64",  "01300": "age_50_64",     # 50-64歳
    "01400": "age_65_plus","01500": "age_65_plus","01600": "age_65_plus",   # 65歳以上
    "01700": "age_65_plus","01800": "age_65_plus",
}

# 都道府県別 e-Stat 統計表ID
# ⚠️ 運用前に必ず最新IDを e-Stat で確認してください (年度更新で変更される場合あり)
#
# DEPRECATED: 2026-06-07
#   この STATS_DATA_IDS テンプレート値は誤り(実IDではない)であることを API で実証済み。
#     - 2020 (0003447040/0003447041) は「特用林産物生産統計調査(きのこ)」を指す別物
#     - 2015 (0003148556/0003148557) は存在しない (getMetaInfo STATUS=300)
#   さらに e-Stat getStatsList のキーワード検索では国勢調査「町丁・字等別(小地域)」表は
#   原理的に取得不可と実証された(searchWord=小地域/町丁/字等別 すべて NUMBER=0)。
#   → 小地域データは e-Stat 統計GIS の境界CSV ダウンロード経路で取得する方針に変更。
#     新パイプライン: scripts/fetch_estat_small_area_csv.py を参照。
#   本辞書は後方互換フォールバックとしてのみ残置(実投入には使用しない)。
STATS_DATA_IDS: dict[int, dict[str, dict[str, str]]] = {
    2020: {
        # 例: 鹿児島県 (要 e-Stat 確認・更新)
        "46": {
            "age_gender":  "0003447040",   # 男女・年齢別人口
            "households":  "0003447041",   # 世帯数
        },
    },
    2015: {
        "46": {
            "age_gender":  "0003148556",
            "households":  "0003148557",
        },
    },
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


# ----------------------------------------------------------------------------
# データクラス
# ----------------------------------------------------------------------------
@dataclass
class TownSnapshot:
    town_code:        str
    prefecture_name:  str
    city_name:        str
    oaza_name:        str
    chome_name:       Optional[str]
    survey_year:      int
    total_population: int = 0
    total_households: int = 0
    age_0_14:         int = 0
    age_15_19:        int = 0
    age_20_29:        int = 0
    age_30_39:        int = 0
    age_40_49:        int = 0
    age_50_64:        int = 0
    age_65_plus:      int = 0
    male_population:   Optional[int] = None
    female_population: Optional[int] = None


@dataclass
class ScoringConfig:
    young_family_min_pop_delta_pct:   float
    young_family_min_family_index:    int
    young_family_min_young_delta_pct: float
    weight_inflow_score:              float
    weight_transaction_count:         float
    weight_area_score:                float


# ----------------------------------------------------------------------------
# Supabase クライアント
# ----------------------------------------------------------------------------
def get_supabase() -> Client:
    url = (os.getenv("SUPABASE_URL")
           or os.getenv("NEXT_PUBLIC_SUPABASE_URL"))
    key = (os.getenv("SUPABASE_SERVICE_KEY")
           or os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
    if not (url and key):
        raise EnvironmentError(
            "SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) と "
            "SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY) を .env.local に設定してください"
        )
    return create_client(url, key)


def load_scoring_config(sb: Client) -> ScoringConfig:
    res = sb.table("scoring_config").select("*").eq("id", 1).single().execute()
    row = res.data
    if not row:
        raise RuntimeError("scoring_config 行が存在しません。マイグレーションを再実行してください。")
    return ScoringConfig(
        young_family_min_pop_delta_pct   = float(row["young_family_min_pop_delta_pct"]),
        young_family_min_family_index    = int(row["young_family_min_family_index"]),
        young_family_min_young_delta_pct = float(row["young_family_min_young_delta_pct"]),
        weight_inflow_score              = float(row["weight_inflow_score"]),
        weight_transaction_count         = float(row["weight_transaction_count"]),
        weight_area_score                = float(row["weight_area_score"]),
    )


# ----------------------------------------------------------------------------
# e-Stat API 取得
# ----------------------------------------------------------------------------
def fetch_estat_stats_data(api_key: str, stats_data_id: str) -> dict:
    """e-Stat getStatsData をリトライ付きで呼び出す"""
    params = {
        "appId":             api_key,
        "statsDataId":       stats_data_id,
        "metaGetFlg":        "Y",
        "cntGetFlg":         "N",
        "sectionHeaderFlg":  "1",
        "limit":             100000,
    }
    last_err: Optional[Exception] = None
    for attempt in range(1, MAX_RETRY + 1):
        try:
            r = requests.get(
                f"{ESTAT_BASE}/getStatsData",
                params=params,
                timeout=REQUEST_TIMEOUT,
            )
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:
            last_err = e
            log.warning(f"e-Stat 取得失敗 (試行 {attempt}/{MAX_RETRY}): {e}")
            time.sleep(RETRY_WAIT * attempt)
    raise RuntimeError(f"e-Stat 取得最終失敗: {last_err}")


def split_area_name(name: str) -> tuple[str, str, str, Optional[str]]:
    """
    "鹿児島県鹿児島市鴨池1丁目" → ("鹿児島県", "鹿児島市", "鴨池", "1丁目")
    e-Stat の AREA_NAME 表記揺れに対応する簡易パーサ。
    """
    pref = city = oaza = ""
    chome: Optional[str] = None

    m = re.match(r"^(.{2,4}?[都道府県])", name)
    if m:
        pref = m.group(1)
        rest = name[len(pref):]
    else:
        rest = name

    m = re.match(r"^(.+?[市区町村])", rest)
    if m:
        city = m.group(1)
        rest = rest[len(city):]

    m = re.search(r"(\d+丁目|[一二三四五六七八九十]+丁目)$", rest)
    if m:
        chome = m.group(1)
        oaza  = rest[:m.start()].strip()
    else:
        oaza = rest.strip()

    return pref, city, oaza, chome


def parse_age_gender_payload(payload: dict, survey_year: int) -> dict[str, TownSnapshot]:
    """
    男女・年齢別人口 統計表のパース。
    - CLASS_OBJ[id=cat01] = 男女別 (000:総数, 001:男, 002:女)
    - CLASS_OBJ[id=cat02] = 年齢階級コード (5歳階級)
    - VALUE[@area]        = 小地域コード (11桁)
    戻り値: { town_code: TownSnapshot(年齢・性別データ部分のみ充填) }
    """
    try:
        stats     = payload["GET_STATS_DATA"]["STATISTICAL_DATA"]
        class_obj = stats["CLASS_INF"]["CLASS_OBJ"]
        values    = stats["DATA_INF"]["VALUE"]
    except KeyError as e:
        raise ValueError(f"e-Stat レスポンス構造が不正: {e}")

    # CLASS_OBJ → コード→名称マップ
    def to_map(obj: dict) -> dict[str, str]:
        cls = obj.get("CLASS")
        if isinstance(cls, dict):
            cls = [cls]
        return {c.get("@code", ""): c.get("@name", "") for c in (cls or [])}

    class_maps  = {co.get("@id", ""): to_map(co) for co in class_obj}
    area_names  = class_maps.get("area", {})

    snapshots: dict[str, TownSnapshot] = {}

    for v in values:
        area_code = v.get("@area", "")
        if not area_code or len(area_code) < 11:
            continue  # 11桁の小地域コードのみ採用 (市区町村集計などはスキップ)

        try:
            val = int(v.get("$", 0))
        except (ValueError, TypeError):
            continue

        cat01 = v.get("@cat01", "")  # 男女別
        cat02 = v.get("@cat02", "")  # 年齢階級

        if area_code not in snapshots:
            pref, city, oaza, chome = split_area_name(area_names.get(area_code, ""))
            snapshots[area_code] = TownSnapshot(
                town_code       = area_code,
                prefecture_name = pref,
                city_name       = city,
                oaza_name       = oaza,
                chome_name      = chome,
                survey_year     = survey_year,
            )

        snap = snapshots[area_code]

        # 男女総数 × 各年齢階級
        if cat01 == "000" and cat02 in AGE_BUCKET_MAP:
            bucket = AGE_BUCKET_MAP[cat02]
            setattr(snap, bucket, getattr(snap, bucket) + val)
            snap.total_population += val
        # 男合計 (年齢=総数)
        elif cat01 == "001" and cat02 == "00000":
            snap.male_population = (snap.male_population or 0) + val
        # 女合計 (年齢=総数)
        elif cat01 == "002" and cat02 == "00000":
            snap.female_population = (snap.female_population or 0) + val

    return snapshots


def parse_household_payload(payload: dict, snapshots: dict[str, TownSnapshot]) -> None:
    """
    世帯数統計表をパースし、既存スナップショットに total_households を埋め込む。
    - CLASS_OBJ[id=cat01] = 世帯人員別 (000:総数 を採用)
    """
    try:
        stats  = payload["GET_STATS_DATA"]["STATISTICAL_DATA"]
        values = stats["DATA_INF"]["VALUE"]
    except KeyError:
        return

    for v in values:
        area_code = v.get("@area", "")
        if len(area_code) < 11:
            continue
        if v.get("@cat01") != "000":
            continue
        snap = snapshots.get(area_code)
        if not snap:
            continue
        try:
            snap.total_households += int(v.get("$", 0))
        except (ValueError, TypeError):
            continue


# ----------------------------------------------------------------------------
# Supabase 書き込み
# ----------------------------------------------------------------------------
def upsert_towns(sb: Client, city_id: str, snaps: list[TownSnapshot]) -> dict[str, str]:
    """towns テーブルに upsert し、{ town_code: town_id } を返す"""
    rows = [{
        "city_id":         city_id,
        "town_code":       s.town_code,
        "prefecture_name": s.prefecture_name,
        "city_name":       s.city_name,
        "oaza_name":       s.oaza_name,
        "chome_name":      s.chome_name,
        "full_name":       f"{s.city_name}{s.oaza_name}{s.chome_name or ''}",
    } for s in snaps]

    if rows:
        for i in range(0, len(rows), UPSERT_BATCH):
            sb.table("towns").upsert(rows[i:i + UPSERT_BATCH], on_conflict="town_code").execute()

    # 反映後の id マップを取得
    existing = sb.table("towns").select("id, town_code").eq("city_id", city_id).execute().data or []
    return {r["town_code"]: r["id"] for r in existing}


def upsert_snapshots(
    sb:           Client,
    town_id_map:  dict[str, str],
    snaps:        list[TownSnapshot],
    stats_data_id: str,
) -> None:
    rows: list[dict] = []
    for s in snaps:
        town_id = town_id_map.get(s.town_code)
        if not town_id:
            continue
        rows.append({
            "town_id":              town_id,
            "survey_year":          s.survey_year,
            "source":               "census",
            "total_population":     s.total_population,
            "total_households":     s.total_households,
            "age_0_14":             s.age_0_14,
            "age_15_19":            s.age_15_19,
            "age_20_29":            s.age_20_29,
            "age_30_39":            s.age_30_39,
            "age_40_49":            s.age_40_49,
            "age_50_64":            s.age_50_64,
            "age_65_plus":          s.age_65_plus,
            "male_population":      s.male_population,
            "female_population":    s.female_population,
            "source_stats_data_id": stats_data_id,
        })

    for i in range(0, len(rows), UPSERT_BATCH):
        sb.table("town_population_snapshots").upsert(
            rows[i:i + UPSERT_BATCH],
            on_conflict="town_id,survey_year,source",
        ).execute()


# ----------------------------------------------------------------------------
# 若返り・ファミリー流入 判定ロジック
# ----------------------------------------------------------------------------
def _clip(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def compute_inflow_score(
    pop_delta_pct:   float,
    family_index:    int,
    young_delta_pct: float,
) -> float:
    """
    inflow_score (0-100) を算出。
      - 人口増加率   : -5%→0点, +15%→100点
      - ファミリー指数: 0人→0点,  100人→100点
      - 20-49歳増加率: 0%→0点,   30%→100点
    内部加重は 30 / 35 / 35 で固定 (3指標を均等に近い形で合成)。
    外側の「複合ランキング」(inflow × 売買回数 × エリアスコア) の重みは
    scoring_config の weight_* で別途調整する。
    """
    pop_norm    = _clip((pop_delta_pct + 5) / 20 * 100, 0, 100)
    family_norm = _clip(family_index / 100.0  * 100,    0, 100)
    young_norm  = _clip(young_delta_pct / 30 * 100,     0, 100)
    return round(pop_norm * 0.30 + family_norm * 0.35 + young_norm * 0.35, 2)


def evaluate_change(
    town_id:      str,
    base:         dict,
    target:       dict,
    cfg:          ScoringConfig,
) -> dict:
    """1町丁目ぶんのデモグラフィック評価結果 dict を返す"""
    base_pop, target_pop   = base["total_population"], target["total_population"]
    base_hh,  target_hh    = base["total_households"], target["total_households"]
    pop_delta_abs          = target_pop - base_pop
    hh_delta_abs           = target_hh  - base_hh
    pop_delta_pct          = (pop_delta_abs / base_pop * 100) if base_pop > 0 else 0.0
    hh_delta_pct           = (hh_delta_abs  / base_hh  * 100) if base_hh  > 0 else 0.0
    base_avg               = base.get("avg_household_size")   or 0
    target_avg             = target.get("avg_household_size") or 0
    avg_delta              = target_avg - base_avg

    base_young             = base["age_family_total"]
    target_young           = target["age_family_total"]
    young_delta_abs        = target_young - base_young
    young_delta_pct        = (young_delta_abs / base_young * 100) if base_young > 0 else 0.0

    family_index_calc      = pop_delta_abs - hh_delta_abs  # DB側の GENERATED と同じ計算

    inflow_score = compute_inflow_score(pop_delta_pct, family_index_calc, young_delta_pct)

    is_inflow = (
        pop_delta_pct   >= cfg.young_family_min_pop_delta_pct  and
        family_index_calc >= cfg.young_family_min_family_index and
        young_delta_pct >= cfg.young_family_min_young_delta_pct
    )

    return {
        "town_id":                  town_id,
        "base_year":                base["survey_year"],
        "target_year":              target["survey_year"],
        "base_population":          base_pop,
        "target_population":        target_pop,
        "population_delta_abs":     pop_delta_abs,
        "population_delta_pct":     round(pop_delta_pct, 2),
        "base_households":          base_hh,
        "target_households":        target_hh,
        "households_delta_abs":     hh_delta_abs,
        "households_delta_pct":     round(hh_delta_pct, 2),
        "avg_household_size_delta": round(avg_delta, 3),
        "young_family_pop_base":    base_young,
        "young_family_pop_target":  target_young,
        "young_family_delta_abs":   young_delta_abs,
        "young_family_delta_pct":   round(young_delta_pct, 2),
        "inflow_score":             inflow_score,
        "is_young_family_inflow":   is_inflow,
        "scoring_config_snapshot":  asdict(cfg),
    }


def compute_and_store_demographics(
    sb:          Client,
    city_id:     str,
    base_year:   int,
    target_year: int,
    cfg:         ScoringConfig,
) -> tuple[int, int]:
    """対象都市の全町丁目で base→target の差分計算 → upsert"""
    towns = sb.table("towns").select("id, full_name").eq("city_id", city_id).execute().data or []
    log.info(f"対象町丁目: {len(towns)} 件")

    results: list[dict] = []
    for t in towns:
        snaps = (
            sb.table("town_population_snapshots")
              .select("*")
              .eq("town_id", t["id"])
              .in_("survey_year", [base_year, target_year])
              .execute()
              .data or []
        )
        base   = next((s for s in snaps if s["survey_year"] == base_year),   None)
        target = next((s for s in snaps if s["survey_year"] == target_year), None)
        if not (base and target):
            continue
        results.append(evaluate_change(t["id"], base, target, cfg))

    inflow_count = sum(1 for r in results if r["is_young_family_inflow"])

    if results:
        for i in range(0, len(results), UPSERT_BATCH):
            sb.table("town_demographics").upsert(
                results[i:i + UPSERT_BATCH],
                on_conflict="town_id,base_year,target_year",
            ).execute()

    log.info(f"判定完了: {len(results)} 件 / 若返り・ファミリー流入: {inflow_count} 件")

    # 上位5件をログ
    for r in sorted(results, key=lambda x: x["inflow_score"], reverse=True)[:5]:
        log.info(
            f"  score={r['inflow_score']:5.1f} | pop_delta={r['population_delta_abs']:+5d} "
            f"| family_idx={r['population_delta_abs'] - r['households_delta_abs']:+5d} "
            f"| young_delta={r['young_family_delta_pct']:+5.1f}% | inflow={r['is_young_family_inflow']}"
        )

    return len(results), inflow_count


# ----------------------------------------------------------------------------
# メイン
# ----------------------------------------------------------------------------
def fetch_year(
    sb:        Client,
    city_id:   str,
    api_key:   str,
    pref_code: str,
    year:      int,
) -> None:
    """指定年の e-Stat 取得 → towns / snapshots を upsert"""
    pref_entry = STATS_DATA_IDS.get(year, {}).get(pref_code)
    if not pref_entry:
        log.warning(f"statsDataId が未登録 (year={year}, pref={pref_code}) → スキップ")
        return

    log.info(f"--- e-Stat 取得: year={year}, pref={pref_code} ---")

    # 男女・年齢別人口
    payload_age = fetch_estat_stats_data(api_key, pref_entry["age_gender"])
    snaps_map   = parse_age_gender_payload(payload_age, survey_year=year)
    log.info(f"  人口/年齢パース: {len(snaps_map)} 町丁目")

    # 世帯数 (別の統計表IDのため独立取得)
    if pref_entry.get("households"):
        payload_hh = fetch_estat_stats_data(api_key, pref_entry["households"])
        parse_household_payload(payload_hh, snaps_map)
        log.info("  世帯数パース完了")

    snapshots = list(snaps_map.values())
    if not snapshots:
        log.warning(f"  year={year} の取得結果が空")
        return

    town_id_map = upsert_towns(sb, city_id, snapshots)
    upsert_snapshots(sb, town_id_map, snapshots, pref_entry["age_gender"])
    log.info(f"  Supabase 反映: towns={len(town_id_map)} / snapshots={len(snapshots)}")


def main() -> None:
    parser = argparse.ArgumentParser(description="町丁目別 若返り・ファミリー流入スコアリング")
    parser.add_argument("--city",        required=True, help="cities.name_en (例: kagoshima)")
    parser.add_argument("--pref-code",   required=True, help="都道府県コード 2桁 (例: 46)")
    parser.add_argument("--base-year",   type=int, default=DEFAULT_BASE_YEAR)
    parser.add_argument("--target-year", type=int, default=DEFAULT_TARGET_YEAR)
    parser.add_argument("--skip-fetch",  action="store_true",
                        help="e-Stat 取得をスキップし、既存snapshot から計算のみ実行")
    args = parser.parse_args()

    api_key = os.getenv("ESTAT_API_KEY", "")
    if not api_key and not args.skip_fetch:
        log.error("ESTAT_API_KEY が未設定です (--skip-fetch でAPI取得を省略可能)")
        sys.exit(1)

    sb  = get_supabase()
    cfg = load_scoring_config(sb)
    log.info(f"scoring_config: {asdict(cfg)}")

    # 対象都市の解決
    city_res = sb.table("cities").select("id, name").eq("name_en", args.city).single().execute().data
    if not city_res:
        log.error(f"cities に name_en='{args.city}' が見つかりません")
        sys.exit(1)
    city_id = city_res["id"]
    log.info(f"対象都市: {city_res['name']} (id={city_id})")

    # e-Stat 取得
    if not args.skip_fetch:
        for y in (args.base_year, args.target_year):
            fetch_year(sb, city_id, api_key, args.pref_code, y)

    # 差分計算 & 保存
    total, inflow = compute_and_store_demographics(
        sb, city_id, args.base_year, args.target_year, cfg
    )
    log.info("=" * 60)
    log.info(f"完了: 評価 {total} 件 / 若返り判定 {inflow} 件")
    log.info("=" * 60)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
 ⚠️ DEPRECATED: 2026-06-07
   e-Stat getStatsList のキーワード検索では国勢調査「町丁・字等別(小地域)」集計の
   統計表は取得できないことを API で実証した(appId/statsCode は有効に動作するが、
   searchWord=小地域/町丁/字等別/男女別人口総数及び世帯総数 等はすべて NUMBER=0、
   statsCode=00200521+surveyYears=2020 を列挙しても小地域表は0件)。
   よって本スクリプトのアプローチは廃案。小地域データは e-Stat 統計GIS の
   境界CSV ダウンロード経路で取得する(scripts/fetch_estat_small_area_csv.py)。
   本ファイルは将来の参考・経緯記録としてのみ保管し、実行しないこと。
=============================================================================
 scripts/discover_estat_ids.py
 目的: e-Stat getStatsList API を叩き、国勢調査「小地域(町丁・字等別)」集計の
       実 statsDataId を都道府県別に検索 → scripts/estat_ids.json に保存する。

 build_young_family_inflow.py の STATS_DATA_IDS はテンプレート値のため、
 本スクリプトで取得した実 ID に置き換える前段として使う。

 - 統計表 ID は推測しない。必ず getStatsList の結果から抽出する。
 - 最初は --dry-run で候補を目視確認し、妥当性を確認してから本保存する運用。

 env:
   ESTAT_API_KEY  - e-Stat アプリケーションID (必須)

 例:
   # 鹿児島のみ・2020・候補表示のみ(保存しない)
   python3 scripts/discover_estat_ids.py --pref-codes 46 --years 2020 --verbose --dry-run
   # 鹿児島・2020と2015を本取得して JSON 保存
   python3 scripts/discover_estat_ids.py --pref-codes 46 --years "2020,2015"
=============================================================================
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from typing import Optional

import requests
from dotenv import load_dotenv

# ----------------------------------------------------------------------------
# 設定
# ----------------------------------------------------------------------------
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env.local"))

ESTAT_BASE      = "https://api.e-stat.go.jp/rest/3.0/app/json"
REQUEST_TIMEOUT = 60
RETRY_WAIT      = 3
MAX_RETRY       = 3

# 国勢調査の statsCode (政府統計コード)
CENSUS_STATS_CODE = "00200521"

# 出力先
OUT_PATH = os.path.join(os.path.dirname(__file__), "estat_ids.json")

# カテゴリ別の検索ワード。小地域(町丁・字等別)集計の統計表を引くための語。
# age_gender: 男女・年齢(5歳階級)別人口 / households: 世帯数(世帯の家族類型等含む)
CATEGORY_QUERIES = {
    "age_gender": "小地域 男女 年齢",
    "households": "小地域 世帯",
}

# 小地域集計であることを示す統計表名の手がかり
SMALL_AREA_HINTS = ("小地域", "町丁・字等別", "町丁字等別", "町丁・字")

# カテゴリ判定の強い手がかり(スコアリング用)
CATEGORY_KEYWORDS = {
    "age_gender": ("男女", "年齢", "５歳", "5歳", "年齢別"),
    "households": ("世帯", "世帯数", "世帯の"),
}

# JIS X 0401 都道府県コード → 名称 (統計表名に含まれる都道府県名でフィルタするため)
PREF_NAME_BY_CODE = {
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

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


# ----------------------------------------------------------------------------
# e-Stat getStatsList 呼び出し
# ----------------------------------------------------------------------------
def fetch_stats_list(api_key: str, search_word: str, survey_year: int) -> list[dict]:
    """getStatsList をリトライ付きで呼び出し、TABLE_INF のリストを返す"""
    params = {
        "appId":        api_key,
        "statsCode":    CENSUS_STATS_CODE,
        "searchWord":   search_word,
        "surveyYears":  str(survey_year),
        "searchKind":   "1",          # 統計表情報
        "limit":        2000,
    }
    last_err: Optional[Exception] = None
    for attempt in range(1, MAX_RETRY + 1):
        try:
            r = requests.get(
                f"{ESTAT_BASE}/getStatsList",
                params=params,
                timeout=REQUEST_TIMEOUT,
            )
            r.raise_for_status()
            payload = r.json()
            return _extract_tables(payload)
        except requests.RequestException as e:
            last_err = e
            log.warning(f"getStatsList 取得失敗 (試行 {attempt}/{MAX_RETRY}): {e}")
            time.sleep(RETRY_WAIT * attempt)
    raise RuntimeError(f"getStatsList 取得最終失敗: {last_err}")


def _extract_tables(payload: dict) -> list[dict]:
    """getStatsList レスポンスから TABLE_INF を取り出す。STATUS!=0 なら例外。"""
    root = payload.get("GET_STATS_LIST", {})
    result = root.get("RESULT", {})
    status = result.get("STATUS")
    if status not in (0, "0", None):
        raise RuntimeError(
            f"e-Stat エラー STATUS={status}: {result.get('ERROR_MSG')}"
        )
    datalist = root.get("DATALIST_INF", {}) or {}
    tables = datalist.get("TABLE_INF", [])
    if isinstance(tables, dict):   # 1件のときは dict で返る
        tables = [tables]
    return tables


def _stringify(value) -> str:
    """TABLE_INF のフィールド(str / dict / list)を検索用テキストに平坦化"""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        # e-Stat は {"@code":..., "$":"表示名"} 形式が多い
        return " ".join(_stringify(v) for v in value.values())
    if isinstance(value, list):
        return " ".join(_stringify(v) for v in value)
    return str(value)


def table_text(table: dict) -> str:
    """統計表の検索対象テキスト(名称類を連結)"""
    parts = [
        _stringify(table.get("STAT_NAME")),
        _stringify(table.get("STATISTICS_NAME")),
        _stringify(table.get("TITLE")),
        _stringify(table.get("TITLE_SPEC")),
        _stringify(table.get("SURVEY_DATE")),
    ]
    return " ".join(p for p in parts if p)


def is_small_area(text: str) -> bool:
    return any(h in text for h in SMALL_AREA_HINTS)


def category_score(text: str, category: str) -> int:
    return sum(1 for kw in CATEGORY_KEYWORDS[category] if kw in text)


# ----------------------------------------------------------------------------
# 候補抽出
# ----------------------------------------------------------------------------
def find_candidates(
    api_key: str,
    pref_code: str,
    year: int,
    category: str,
    verbose: bool,
) -> list[dict]:
    """指定 (都道府県, 年, カテゴリ) の小地域統計表候補をスコア順で返す"""
    pref_name = PREF_NAME_BY_CODE.get(pref_code)
    if not pref_name:
        log.error(f"未知の都道府県コード: {pref_code}")
        return []

    query = CATEGORY_QUERIES[category]
    tables = fetch_stats_list(api_key, query, year)

    candidates = []
    for t in tables:
        text = table_text(t)
        if not is_small_area(text):
            continue
        if pref_name not in text:        # 統計表名に当該都道府県名を含むものだけ
            continue
        score = category_score(text, category)
        if score == 0:
            continue
        candidates.append({
            "id":    t.get("@id"),
            "score": score,
            "name":  _stringify(t.get("STATISTICS_NAME")) or _stringify(t.get("TITLE")),
            "title": _stringify(t.get("TITLE")),
            "survey_date": _stringify(t.get("SURVEY_DATE")),
        })

    candidates.sort(key=lambda c: c["score"], reverse=True)

    if verbose:
        log.info(
            f"[{year}/{pref_name}/{category}] query='{query}' "
            f"取得表数={len(tables)} 候補数={len(candidates)}"
        )
    return candidates


# ----------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description="e-Stat 国勢調査 小地域 statsDataId 探索")
    ap.add_argument("--pref-codes", default="",
                    help="JISコードのカンマ区切り (例: '46' / '13,46'). 省略時は全47")
    ap.add_argument("--years", default="2020,2015",
                    help="調査年カンマ区切り (既定: 2020,2015)")
    ap.add_argument("--dry-run", action="store_true",
                    help="JSON保存せず候補一覧のみ表示")
    ap.add_argument("--verbose", action="store_true",
                    help="各クエリの取得状況を表示")
    ap.add_argument("--top", type=int, default=5,
                    help="dry-run時に表示する候補上位件数 (既定: 5)")
    args = ap.parse_args()

    api_key = os.getenv("ESTAT_API_KEY", "")
    if not api_key:
        log.error("ESTAT_API_KEY が未設定です (.env.local を確認してください)")
        return 1

    years = [int(y.strip()) for y in args.years.split(",") if y.strip()]
    if args.pref_codes.strip():
        pref_codes = [p.strip().zfill(2) for p in args.pref_codes.split(",") if p.strip()]
    else:
        pref_codes = list(PREF_NAME_BY_CODE.keys())

    log.info(f"対象: years={years} prefs={pref_codes} dry_run={args.dry_run}")

    result: dict = {str(y): {} for y in years}
    total_scanned = 0

    for year in years:
        for pref in pref_codes:
            pref_name = PREF_NAME_BY_CODE.get(pref, pref)
            chosen: dict = {}
            for category in CATEGORY_QUERIES:
                cands = find_candidates(api_key, pref, year, category, args.verbose)
                total_scanned += len(cands)

                if args.dry_run:
                    print(f"\n=== {year} / {pref} {pref_name} / {category} "
                          f"(上位{min(args.top, len(cands))} / 全{len(cands)}件) ===")
                    if not cands:
                        print("  候補なし(検索語またはフィルタ条件を見直してください)")
                    for i, c in enumerate(cands[:args.top], 1):
                        print(f"  {i}. id={c['id']} score={c['score']} "
                              f"survey_date={c['survey_date']}")
                        print(f"     {c['name']}")
                else:
                    if cands:
                        chosen[category] = cands[0]["id"]
                    else:
                        log.warning(f"{year}/{pref_name}/{category}: 候補なし → 未設定")

            if not args.dry_run and chosen:
                result[str(year)][pref] = chosen

    if args.dry_run:
        print("\n[dry-run] JSON は保存していません。"
              "候補が妥当なら --dry-run を外して本取得してください。")
        return 0

    result["_meta"] = {
        "fetched_at":   datetime.now(timezone.utc).isoformat(),
        "stats_code":   CENSUS_STATS_CODE,
        "queries":      CATEGORY_QUERIES,
        "years":        years,
        "pref_codes":   pref_codes,
        "candidates_scanned": total_scanned,
        "note": "build_young_family_inflow.py が起動時に優先読み込みする",
    }

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    log.info(f"保存しました: {OUT_PATH}")

    # サマリ
    for y in years:
        got = result[str(y)]
        log.info(f"  {y}: {len(got)} 都道府県分の ID を取得 "
                 f"({', '.join(sorted(got.keys())) or 'なし'})")
    return 0


if __name__ == "__main__":
    sys.exit(main())

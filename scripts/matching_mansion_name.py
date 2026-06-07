#!/usr/bin/env python3
"""
=============================================================================
 scripts/matching_mansion_name.py
 ── マンション名 自動補完 (名寄せ) バッチスクリプト
=============================================================================
配置先  : scripts/matching_mansion_name.py
タスク  : #8.5 取引データの名寄せ (マンション名補完ロジック)

概要:
  reinfolib (国交省) 由来の trade_history テーブルにおいて、
  mansion_name_raw が NULL / 伏字 / 部分一致しない取引レコードを抽出し、
  同市区町村の mansion_master と「町名 × 建築年(±1年) × 構造」で
  名寄せスコアを算出。scoring_config の二段階しきい値に従い:

    score >= auto_threshold   → 'auto_matched'      (mansion_id を紐付け)
    score >= review_threshold → 'requires_review'   (候補は保持、紐付けは保留)
    上記以外                  → 'unresolvable'

  全国47都道府県を JIS コードで横断可能。 --city-code (5桁) 単位で実行。

使用例:
  # 鹿児島市 (city_code=46201) を対象に名寄せ
  python scripts/matching_mansion_name.py --city-code 46201

  # 鹿児島県全市を対象 (都道府県コード指定で配下市区町村を一括)
  python scripts/matching_mansion_name.py --pref-code 46

  # ドライラン (DB 書き込みなし)
  python scripts/matching_mansion_name.py --city-code 46201 --dry-run

  # 既に auto_matched のレコードも再評価 (例: マスター更新後)
  python scripts/matching_mansion_name.py --city-code 46201 --rematch

環境変数 (.env.local):
  SUPABASE_URL          - Supabase プロジェクトURL
  SUPABASE_SERVICE_KEY  - サービスロールキー (RLS bypass)
=============================================================================
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import sys
import time
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from difflib import SequenceMatcher
from typing import Iterable, Optional

from dotenv import load_dotenv
from supabase import Client, create_client

# 設定
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env.local"))

BATCH_FETCH       = 1000
BATCH_UPDATE      = 500
DEFAULT_LIMIT     = 100_000

# 名寄せスコアの内部加重 (3軸: 住所 / 建築年 / 構造)
# scoring_config に分離してもよいが、まずは固定値で運用
DEFAULT_WEIGHTS = {
    "address":       0.40,
    "building_year": 0.30,
    "structure":     0.30,
}

# 「マンション名が空欄/伏字とみなす」判定パターン
EMPTY_NAME_PATTERNS = [
    re.compile(r"^\s*$"),                          # 空白のみ
    re.compile(r"^[\*＊●○・…−ー\-\s]+$"),         # 伏字・記号のみ
    re.compile(r"^マンション$"),                    # 「マンション」のみ
    re.compile(r"^[A-Za-z\s]+$"),                  # 英字のみ (一部 reinfolib で 'Mansion' になるケース対策)
]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


# ============================================================
# データクラス
# ============================================================
@dataclass
class MatchWeights:
    address:       float = 0.40
    building_year: float = 0.30
    structure:     float = 0.30


@dataclass
class MatchThresholds:
    auto:   float = 0.85   # この値以上で自動補完
    review: float = 0.60   # auto 未満かつこの値以上で人手レビュー


@dataclass
class MatchScore:
    total:    float
    address:  float
    building: float
    structure: float

    def as_dict(self) -> dict:
        return {
            "total":         round(self.total, 4),
            "address":       round(self.address, 4),
            "building_year": round(self.building, 4),
            "structure":     round(self.structure, 4),
        }


@dataclass
class MatchResult:
    """1取引レコード分の名寄せ結果"""
    trade_id:             str
    status:               str                    # 'auto_matched' | 'requires_review' | 'unresolvable'
    confidence:           Optional[float]
    matched_mansion_id:   Optional[str]
    matched_mansion_name: Optional[str]
    candidates:           list[dict] = field(default_factory=list)
    log_detail:           dict       = field(default_factory=dict)


@dataclass
class CityMatchSummary:
    city_code:        str
    processed:        int = 0
    auto_matched:     int = 0
    requires_review:  int = 0
    unresolvable:     int = 0
    not_applicable:   int = 0
    skipped:          int = 0


# ============================================================
# 正規化ユーティリティ
# ============================================================
_STRUCTURE_NORMALIZE_MAP: dict[str, str] = {
    "RC":   "RC", "ＲＣ": "RC", "鉄筋コンクリート": "RC", "鉄筋コンクリート造": "RC",
    "SRC":  "SRC", "ＳＲＣ": "SRC", "鉄骨鉄筋コンクリート": "SRC", "鉄骨鉄筋コンクリート造": "SRC",
    "S":    "S",  "Ｓ": "S", "鉄骨": "S", "鉄骨造": "S",
    "W":    "W",  "Ｗ": "W", "木造": "W", "木": "W",
    "CB":   "CB", "コンクリートブロック": "CB",
    "LGS":  "LGS","軽量鉄骨": "LGS",
}


def normalize_text(s: Optional[str]) -> str:
    """全角/半角・カナ/ひらがな・記号を正規化"""
    if not s:
        return ""
    # NFKC で全角英数 → 半角, ｶﾅ → カナ
    s = unicodedata.normalize("NFKC", s)
    # 余計な空白
    s = re.sub(r"\s+", "", s)
    # 記号を除去
    s = re.sub(r"[・,、。\.\-‐−ー―_/／・]", "", s)
    return s.lower()


def normalize_structure(raw: Optional[str]) -> Optional[str]:
    """構造文字列を 'RC' / 'SRC' / 'S' / 'W' などの正規形に"""
    if not raw:
        return None
    s = unicodedata.normalize("NFKC", raw).strip().upper()
    # 長いキーから順に試す (SRC が RC より先に拾えるよう)
    for key in sorted(_STRUCTURE_NORMALIZE_MAP.keys(), key=len, reverse=True):
        if key in s:
            return _STRUCTURE_NORMALIZE_MAP[key]
    return None


def is_name_missing(name: Optional[str]) -> bool:
    """マンション名が「補完対象」と判定されるか"""
    if name is None:
        return True
    n = name.strip()
    if not n:
        return True
    return any(p.match(n) for p in EMPTY_NAME_PATTERNS)


# ============================================================
# Supabase クライアント
# ============================================================
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


def load_thresholds(sb: Client) -> MatchThresholds:
    res = sb.table("scoring_config").select(
        "name_resolution_auto_threshold, name_resolution_review_threshold"
    ).eq("id", 1).single().execute()
    row = res.data
    if not row:
        raise RuntimeError("scoring_config が存在しません")
    return MatchThresholds(
        auto   = float(row["name_resolution_auto_threshold"]),
        review = float(row["name_resolution_review_threshold"]),
    )


# ============================================================
# スコア計算
# ============================================================
class MansionNameMatcher:
    """
    名寄せエンジン。市区町村単位でインスタンス化して使う。

    Usage:
        matcher = MansionNameMatcher(sb, thresholds, weights)
        summary = matcher.match_city("46201", dry_run=False)
    """

    def __init__(
        self,
        sb: Client,
        thresholds: MatchThresholds,
        weights:    Optional[MatchWeights] = None,
    ):
        self.sb         = sb
        self.thresholds = thresholds
        self.weights    = weights or MatchWeights(**DEFAULT_WEIGHTS)

    # ---- 公開API ------------------------------------------------------

    def match_city(
        self,
        city_code: str,
        *,
        dry_run:  bool = False,
        rematch:  bool = False,
        limit:    int  = DEFAULT_LIMIT,
    ) -> CityMatchSummary:
        """指定市区町村 (JIS5桁) の trade_history を名寄せ"""
        log.info(f"━━━ 名寄せ開始: city_code={city_code} (dry_run={dry_run}, rematch={rematch}) ━━━")
        summary = CityMatchSummary(city_code=city_code)

        # 1. マスター取得 (該当市区町村のみ)
        masters = self._fetch_masters(city_code)
        log.info(f"  マスター件数: {len(masters)}")
        if not masters:
            log.warning(f"  mansion_master が空のため、名寄せをスキップ: city_code={city_code}")
            return summary

        # 2. 取引履歴の取得 (補完対象のレコードのみ)
        trades = self._fetch_target_trades(city_code, rematch=rematch, limit=limit)
        log.info(f"  処理対象取引: {len(trades)} 件")

        # 3. 名寄せ実行
        results: list[MatchResult] = []
        for trade in trades:
            summary.processed += 1
            # マンション名が「埋まっている」ものは not_applicable
            if not is_name_missing(trade.get("mansion_name_raw")):
                summary.not_applicable += 1
                if not dry_run:
                    self._mark_not_applicable(trade["id"])
                continue
            result = self._match_one(trade, masters)
            results.append(result)
            if result.status == "auto_matched":     summary.auto_matched    += 1
            elif result.status == "requires_review": summary.requires_review += 1
            else:                                    summary.unresolvable    += 1

        # 4. DB 書き戻し
        if not dry_run and results:
            self._persist_results(results)

        log.info(
            f"  ── 結果: 自動={summary.auto_matched} | "
            f"要レビュー={summary.requires_review} | "
            f"不可={summary.unresolvable} | "
            f"対象外={summary.not_applicable} | "
            f"処理={summary.processed}"
        )
        return summary

    def match_prefecture(self, pref_code: str, **kwargs) -> list[CityMatchSummary]:
        """都道府県内の全 city_code に対して名寄せを実行"""
        cities = self._distinct_city_codes(pref_code)
        log.info(f"━━━ 都道府県一括: pref={pref_code} / {len(cities)} 市区町村 ━━━")
        return [self.match_city(c, **kwargs) for c in cities]

    # ---- 内部実装 -----------------------------------------------------

    def _fetch_masters(self, city_code: str) -> list[dict]:
        """マスターをページングで全取得"""
        all_rows: list[dict] = []
        page = 0
        while True:
            res = (
                self.sb.table("mansion_master")
                  .select("id, name, normalized_name, town_name, chome, banchi,"
                          " building_year, structure, address")
                  .eq("city_code", city_code)
                  .range(page * BATCH_FETCH, (page + 1) * BATCH_FETCH - 1)
                  .execute()
            )
            rows = res.data or []
            all_rows.extend(rows)
            if len(rows) < BATCH_FETCH:
                break
            page += 1
        return all_rows

    def _fetch_target_trades(self, city_code: str, *, rematch: bool, limit: int) -> list[dict]:
        """名寄せ対象の trade_history を取得"""
        query = (
            self.sb.table("trade_history")
              .select("id, mansion_name_raw, town_name, chome, building_year, structure,"
                      " area_sqm, traded_year, mansion_id, resolution_status")
              .eq("city_code", city_code)
              .limit(limit)
        )
        if rematch:
            # 既処理も再評価
            query = query.in_("resolution_status",
                              ["unresolved", "requires_review", "auto_matched", "unresolvable"])
        else:
            # 未処理 / レビュー保留のみ
            query = query.in_("resolution_status", ["unresolved", "requires_review"])
        res = query.execute()
        return res.data or []

    def _distinct_city_codes(self, pref_code: str) -> list[str]:
        """trade_history に存在する pref_code 配下の city_code を列挙"""
        res = (
            self.sb.table("trade_history")
              .select("city_code")
              .eq("prefecture_code", pref_code)
              .execute()
        )
        seen: set[str] = set()
        for r in res.data or []:
            c = r.get("city_code")
            if c:
                seen.add(c)
        return sorted(seen)

    # ---- スコア計算 ---------------------------------------------------

    def _score_address(self, trade: dict, master: dict) -> float:
        """町名の一致度 (0.0〜1.0)"""
        t_town = normalize_text(trade.get("town_name"))
        m_town = normalize_text(master.get("town_name"))
        if not t_town or not m_town:
            return 0.0
        # 完全一致
        if t_town == m_town:
            base = 1.0
        else:
            # SequenceMatcher で類似度
            ratio = SequenceMatcher(None, t_town, m_town).ratio()
            # 部分包含もボーナス (例: trade.town="鴨池1丁目" master.town="鴨池")
            if t_town in m_town or m_town in t_town:
                ratio = max(ratio, 0.85)
            base = ratio

        # 丁目が両方あれば一致でボーナス、不一致で減点
        t_chome = normalize_text(trade.get("chome"))
        m_chome = normalize_text(master.get("chome"))
        if t_chome and m_chome:
            if t_chome == m_chome:
                base = min(1.0, base + 0.10)
            else:
                base = max(0.0, base - 0.20)
        return round(base, 4)

    def _score_building_year(self, trade: dict, master: dict) -> float:
        """建築年の一致度。完全一致=1.0, ±1年=0.7, ±3年=0.3, それ以外=0"""
        t_y = trade.get("building_year")
        m_y = master.get("building_year")
        if not t_y or not m_y:
            return 0.50  # データ欠損は中立扱い
        diff = abs(int(t_y) - int(m_y))
        if diff == 0: return 1.00
        if diff == 1: return 0.70
        if diff <= 3: return 0.30
        return 0.0

    def _score_structure(self, trade: dict, master: dict) -> float:
        """構造の完全一致 (1.0 / 0.0)"""
        t_s = normalize_structure(trade.get("structure"))
        m_s = normalize_structure(master.get("structure"))
        if not t_s or not m_s:
            return 0.50  # 欠損は中立
        return 1.0 if t_s == m_s else 0.0

    def _compute_score(self, trade: dict, master: dict) -> MatchScore:
        a = self._score_address(trade, master)
        b = self._score_building_year(trade, master)
        s = self._score_structure(trade, master)
        total = a * self.weights.address + b * self.weights.building_year + s * self.weights.structure
        return MatchScore(total=round(total, 4), address=a, building=b, structure=s)

    # ---- 1レコードの名寄せ -------------------------------------------

    def _match_one(self, trade: dict, masters: list[dict]) -> MatchResult:
        # 全マスターと突合してスコア計算
        scored: list[tuple[float, dict, MatchScore]] = []
        for m in masters:
            score = self._compute_score(trade, m)
            scored.append((score.total, m, score))

        # 上位5件を候補として保持
        scored.sort(key=lambda x: x[0], reverse=True)
        top5 = scored[:5]
        candidates = [
            {
                "mansion_id":   m["id"],
                "mansion_name": m["name"],
                "score":        s.total,
                "breakdown":    s.as_dict(),
            }
            for _, m, s in top5
        ]

        best_total, best_m, best_score = top5[0] if top5 else (0.0, None, None)

        # 閾値判定
        if best_score and best_total >= self.thresholds.auto:
            status     = "auto_matched"
            mansion_id = best_m["id"]
            mname      = best_m["name"]
        elif best_score and best_total >= self.thresholds.review:
            status     = "requires_review"
            mansion_id = None
            mname      = None
        else:
            status     = "unresolvable"
            mansion_id = None
            mname      = None

        return MatchResult(
            trade_id             = trade["id"],
            status               = status,
            confidence           = round(best_total, 4) if best_score else 0.0,
            matched_mansion_id   = mansion_id,
            matched_mansion_name = mname,
            candidates           = candidates,
            log_detail           = {
                "thresholds": {
                    "auto":   self.thresholds.auto,
                    "review": self.thresholds.review,
                },
                "weights":      DEFAULT_WEIGHTS,
                "best_breakdown": best_score.as_dict() if best_score else None,
                "matched_at":   datetime.now(timezone.utc).isoformat(),
            },
        )

    # ---- 書き戻し -----------------------------------------------------

    def _mark_not_applicable(self, trade_id: str) -> None:
        """マンション名が埋まっているレコードを 'not_applicable' に更新"""
        self.sb.table("trade_history").update({
            "resolution_status": "not_applicable",
            "resolved_at":       datetime.now(timezone.utc).isoformat(),
        }).eq("id", trade_id).execute()

    def _persist_results(self, results: Iterable[MatchResult]) -> None:
        """名寄せ結果を trade_history に反映 (バッチ更新)"""
        items = list(results)
        for i in range(0, len(items), BATCH_UPDATE):
            chunk = items[i:i + BATCH_UPDATE]
            # supabase-py には bulk update がないため、1件ずつ更新
            # 速度が必要なら RPC や PostgREST upsert に切り替え可
            for r in chunk:
                payload = {
                    "resolution_status":     r.status,
                    "resolution_confidence": r.confidence,
                    "resolution_candidates": r.candidates,
                    "resolution_log":        r.log_detail,
                    "resolved_at":           datetime.now(timezone.utc).isoformat(),
                    "resolved_by":           "batch:matching_mansion_name",
                }
                if r.matched_mansion_id:
                    payload["mansion_id"]            = r.matched_mansion_id
                    payload["mansion_name_resolved"] = r.matched_mansion_name
                self.sb.table("trade_history").update(payload).eq("id", r.trade_id).execute()


# ============================================================
# CLI
# ============================================================
def main() -> None:
    parser = argparse.ArgumentParser(description="マンション名 名寄せバッチ")
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--city-code", help="市区町村 JIS コード (5桁) 例: 46201")
    target.add_argument("--pref-code", help="都道府県 JIS コード (2桁) 例: 46 (配下全市を処理)")

    parser.add_argument("--dry-run", action="store_true", help="DB 書き込みを行わない")
    parser.add_argument("--rematch", action="store_true",
                        help="既に auto_matched / unresolvable のレコードも再評価")
    parser.add_argument("--limit",   type=int, default=DEFAULT_LIMIT,
                        help="1市区町村あたり最大処理件数 (default: 100000)")
    args = parser.parse_args()

    sb         = get_supabase()
    thresholds = load_thresholds(sb)
    log.info(f"閾値: auto={thresholds.auto}, review={thresholds.review}")
    matcher = MansionNameMatcher(sb, thresholds)

    start = time.time()
    if args.city_code:
        matcher.match_city(args.city_code, dry_run=args.dry_run, rematch=args.rematch, limit=args.limit)
    else:
        matcher.match_prefecture(args.pref_code, dry_run=args.dry_run, rematch=args.rematch, limit=args.limit)
    log.info(f"完了: 経過 {time.time() - start:.1f}s")


if __name__ == "__main__":
    main()

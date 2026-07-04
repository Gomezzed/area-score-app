#!/usr/bin/env python3
"""
Fetch current-month Flat 35 official interest rates into national_metrics.

The source page only exposes the current month, so this ETL is intentionally
forward-looking: run it monthly and upsert the public facts for that month.
Use --dry-run to inspect planned rows without DB writes.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import unicodedata
from collections.abc import Iterable
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Any
from urllib.request import Request, urlopen

from dotenv import load_dotenv
from supabase import Client, create_client


load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env.local"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

SOURCE_URL = "https://www.flat35.com/kinri/index.html"
SOURCE_NAME = "住宅金融支援機構 フラット35"
ON_CONFLICT = "metric_type,value_type,series,year,month"
REQUEST_TIMEOUT = 30
MIN_ALLOWED_RATE = 0.1
MAX_ALLOWED_RATE = 20.0


class ParseError(RuntimeError):
    pass


class Flat35RateParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[tuple[str, Any]] = []
        self._in_table = False
        self._in_tr = False
        self._in_cell = False
        self._table_rows: list[list[str]] = []
        self._row_cells: list[str] = []
        self._cell_text: list[str] = []
        self._text_tag: str | None = None
        self._text_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "table":
            self._flush_text_block()
            self._in_table = True
            self._table_rows = []
            return
        if self._in_table:
            if tag == "tr":
                self._in_tr = True
                self._row_cells = []
            elif tag in ("td", "th"):
                self._in_cell = True
                self._cell_text = []
            return
        if tag in ("h1", "h2", "h3", "p"):
            self._flush_text_block()
            self._text_tag = tag
            self._text_parts = []

    def handle_endtag(self, tag: str) -> None:
        if self._in_table:
            if tag in ("td", "th") and self._in_cell:
                self._row_cells.append(clean_text("".join(self._cell_text)))
                self._in_cell = False
                self._cell_text = []
            elif tag == "tr" and self._in_tr:
                if any(cell for cell in self._row_cells):
                    self._table_rows.append(self._row_cells)
                self._in_tr = False
                self._row_cells = []
            elif tag == "table":
                self.blocks.append(("table", self._table_rows))
                self._in_table = False
                self._table_rows = []
            return
        if tag == self._text_tag:
            self._flush_text_block()

    def handle_data(self, data: str) -> None:
        if self._in_cell:
            self._cell_text.append(data)
        elif self._text_tag:
            self._text_parts.append(data)

    def _flush_text_block(self) -> None:
        if not self._text_tag:
            return
        text = clean_text("".join(self._text_parts))
        if text:
            self.blocks.append((self._text_tag, text))
        self._text_tag = None
        self._text_parts = []

    def close(self) -> None:
        self._flush_text_block()
        super().close()


def env_required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} が未設定です。export 後に再実行してください。")
    return value


def get_supabase() -> Client:
    return create_client(env_required("SUPABASE_URL"), env_required("SUPABASE_SERVICE_ROLE_KEY"))


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def fetch_source_html() -> str:
    req = Request(SOURCE_URL, headers={"User-Agent": "Mozilla/5.0 area-score T5 ETL"})
    with urlopen(req, timeout=REQUEST_TIMEOUT) as res:
        raw = res.read()
    return unicodedata.normalize("NFKC", raw.decode("euc_jp", "strict"))


def parse_rate(value: str) -> float:
    match = re.search(r"([0-9]+(?:\.[0-9]+)?)", value)
    if not match:
        raise ParseError(f"金利値を抽出できません: {value}")
    rate = float(match.group(1))
    if rate < MIN_ALLOWED_RATE or rate > MAX_ALLOWED_RATE:
        raise ParseError(f"金利値が許容範囲外です: {rate}")
    return rate


def parse_rate_range(value: str) -> tuple[float, float]:
    matches = re.findall(r"([0-9]+(?:\.[0-9]+)?)", value)
    if len(matches) < 2:
        raise ParseError(f"金利範囲を抽出できません: {value}")
    low = float(matches[0])
    high = float(matches[1])
    for rate in (low, high):
        if rate < MIN_ALLOWED_RATE or rate > MAX_ALLOWED_RATE:
            raise ParseError(f"金利値が許容範囲外です: {rate}")
    if low > high:
        raise ParseError(f"最低金利が最高金利を上回っています: min={low} max={high}")
    return low, high


def extract_year_month(blocks: Iterable[tuple[str, Any]]) -> tuple[int, int]:
    for _, content in blocks:
        if not isinstance(content, str):
            continue
        match = re.search(r"([0-9]{4})年\s*([0-9]{1,2})月", content)
        if match:
            year = int(match.group(1))
            month = int(match.group(2))
            if not 1 <= month <= 12:
                raise ParseError(f"月が範囲外です: {month}")
            return year, month
    raise ParseError("ページ表記から年月を抽出できません")


def extract_target_rates(blocks: list[tuple[str, Any]]) -> tuple[float, float, float, str]:
    for index, (kind, content) in enumerate(blocks):
        if not isinstance(content, str):
            continue
        compact = content.replace(" ", "")
        if "借入期間:21年以上35年以下" not in compact:
            continue
        for next_kind, next_content in blocks[index + 1:]:
            if next_kind != "table":
                continue
            rows = next_content
            if not isinstance(rows, list):
                break
            for row in rows:
                if len(row) >= 3 and row[0].replace(" ", "") == "9割以下":
                    low, high = parse_rate_range(row[1])
                    mode = parse_rate(row[2])
                    selector = (
                        "p contains '借入期間:21年以上35年以下' -> next table "
                        "-> row[0]=='9割以下' -> row[1] range / row[2] mode"
                    )
                    return low, high, mode, selector
            raise ParseError("対象テーブル内に '9割以下' 行が見つかりません")
    raise ParseError("'借入期間:21年以上35年以下' の対象ブロックが見つかりません")


def parse_flat35_rates(html: str) -> tuple[int, int, float, float, float, str]:
    parser = Flat35RateParser()
    parser.feed(html)
    parser.close()
    year, month = extract_year_month(parser.blocks)
    low, high, mode, selector = extract_target_rates(parser.blocks)
    return year, month, low, high, mode, selector


def build_rows(year: int, month: int, low: float, high: float, mode: float, fetched_at: str) -> list[dict[str, Any]]:
    base = {
        "metric_type": "interest_rate",
        "value_type": "confirmed",
        "year": year,
        "month": month,
        "unit": "%",
        "source": SOURCE_NAME,
        "source_detail": {
            "url": SOURCE_URL,
            "fetched_at": fetched_at,
        },
    }
    return [
        {**base, "series": "flat35_21_35y_ltv90_min", "value": low},
        {**base, "series": "flat35_21_35y_ltv90_max", "value": high},
        {**base, "series": "flat35_21_35y_ltv90_mode", "value": mode},
    ]


def upsert_national_metrics(sb: Client, rows: list[dict[str, Any]]) -> int:
    sb.table("national_metrics").upsert(rows, on_conflict=ON_CONFLICT).execute()
    return len(rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch current Flat 35 interest rates.")
    parser.add_argument("--dry-run", action="store_true", help="DB書込みなしで投入予定行を出力する。")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        html = fetch_source_html()
        year, month, low, high, mode, selector = parse_flat35_rates(html)
        fetched_at = datetime.now(timezone.utc).isoformat()
        rows = build_rows(year, month, low, high, mode, fetched_at)
    except Exception as exc:
        log.error("Flat35金利の抽出に失敗しました: %s", exc)
        return 1

    print("parse_selector:", selector)
    print("planned_rows:")
    for row in rows:
        print(json.dumps(row, ensure_ascii=False, sort_keys=True))

    if args.dry_run:
        log.info("dry-run complete: planned_rows=%s", len(rows))
        return 0

    try:
        written = upsert_national_metrics(get_supabase(), rows)
    except Exception as exc:
        log.error("national_metrics upsert に失敗しました: %s", exc)
        return 1
    log.info("ETL complete: upserted_rows=%s", written)
    return 0


if __name__ == "__main__":
    sys.exit(main())

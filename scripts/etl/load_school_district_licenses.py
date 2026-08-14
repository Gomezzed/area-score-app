#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/etl/load_school_district_licenses.py

STEP2 / SD-19: R5 条件表由来の CSV を public.school_district_licenses に冪等投入する。

唯一の正 = docs/school_district_licenses_r5*.csv（PR #38 で main にコミット済み）。
判定単位は muni_code_5 × school_type。行が無い自治体は deny-by-default（補完しない）。

使い方:
    python scripts/etl/load_school_district_licenses.py --csv docs/school_district_licenses_r5.csv
    python scripts/etl/load_school_district_licenses.py --csv docs/school_district_licenses_r5.csv --dry-run

接続情報は .env.local から読む（キーはハードコードしない）:
    NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY

注意:
    - CSV は BOM 付き（先頭に U+FEFF）。BOM を除去しないと 1 列目のヘッダ名が壊れて
      KeyError になるため、必ず encoding='utf-8-sig' で開く（下記 CSV_ENCODING）。
    - 真偽値は「明示的なマッピング表」で解釈し、表に無い値は例外にする（暗黙 false にしない）。
    - school_type は 'elementary'/'junior_high'/'compulsory' 以外なら例外（暗黙スキップしない）。
"""

import argparse
import logging
import os
import sys
from collections import Counter, defaultdict

import csv

from dotenv import load_dotenv
from supabase import Client, create_client

# .env.local をリポジトリ直下から読む（既存 ETL と同じ作法）。
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", "..", ".env.local"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)

# --- 定数 ------------------------------------------------------------------

# CSV は BOM 付きのため utf-8-sig で開く（BOM を食わせるとヘッダ名 'muni_code_5' が
# '﻿muni_code_5' になり DictReader が KeyError になる）。
CSV_ENCODING = "utf-8-sig"

TABLE = "school_district_licenses"
ON_CONFLICT = "source_version,muni_code_5,school_type"

# 期待する 21 列（順不同で来る可能性があるためヘッダ名で読む。全て揃わなければ即エラー）。
EXPECTED_COLUMNS = [
    "muni_code_5", "muni_code_6", "pref_code", "muni_name", "school_type",
    "source_type", "source_date", "source_version", "license_type", "license_url",
    "source_url", "commercial_use", "redistribution", "attribution_required",
    "attribution_text", "license_status", "checked_at", "is_priority_target",
    "raw_public", "raw_use", "special_condition",
]

# school_type は既に英語で格納されている（調査結果）。小/中→英語の変換表は作らず、
# 許可値以外は例外にする（暗黙スキップ禁止 = 追加指示1）。
ALLOWED_SCHOOL_TYPES = {"elementary", "junior_high", "compulsory"}

# 真偽値の明示的マッピング（表記ゆれを網羅）。表に無い値は例外（暗黙 false 禁止）。
BOOL_MAP = {
    "true": True, "false": False,
    "TRUE": True, "FALSE": False,
    "True": True, "False": False,
    "1": True, "0": False,
    "可": True, "不可": False,
    "○": True, "×": False,
    "yes": True, "no": False,
    "": None,  # 空は「未指定」。呼び出し側で NOT NULL 列のデフォルト解釈を行う。
}

ALLOWED_LICENSE_STATUS = {"CLEARED", "PENDING", "REJECTED"}

# 空/未指定の真偽値を、NOT NULL 列の安全側デフォルトに落とすための対応。
BOOL_DEFAULT = {
    "commercial_use": False,
    "redistribution": False,
    "attribution_required": True,
}

CHUNK_SIZE = 500


class RowError(Exception):
    """1 行のバリデーション失敗。行番号付きで報告する。"""


# --- ヘルパ ----------------------------------------------------------------

def get_client() -> Client:
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise ValueError(
            "Supabase の接続情報が見つかりません (.env.local: "
            "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)"
        )
    return create_client(url, key)


def parse_bool(col: str, raw: str):
    """真偽値をマッピング表で解釈。表に無い値は例外。空は NOT NULL 列のデフォルトに落とす。"""
    key = (raw or "").strip()
    if key not in BOOL_MAP:
        raise RowError(f"{col}: 真偽値として解釈できない値 '{raw}'（マッピング表に無い）")
    val = BOOL_MAP[key]
    if val is None:  # 空 = 未指定 → 安全側デフォルト。
        return BOOL_DEFAULT[col]
    return val


def normalize_license_status(raw: str) -> str:
    """CSV の値をそのまま使い、空・未知は 'PENDING' に落とす。"""
    val = (raw or "").strip()
    if val not in ALLOWED_LICENSE_STATUS:
        return "PENDING"
    return val


def none_if_blank(raw: str):
    val = (raw or "").strip()
    return val if val else None


def build_row(raw_row: dict, lineno: int) -> dict:
    school_type = (raw_row.get("school_type") or "").strip()
    if school_type not in ALLOWED_SCHOOL_TYPES:
        # 追加指示1: 変換せず、許可値以外は例外（暗黙スキップしない）。
        raise RowError(
            f"school_type が許可値外 '{school_type}'（{sorted(ALLOWED_SCHOOL_TYPES)} のみ許可）"
        )

    muni_code_5 = (raw_row.get("muni_code_5") or "").strip()
    source_version = (raw_row.get("source_version") or "").strip()
    if not muni_code_5:
        raise RowError("muni_code_5 が空")
    if not source_version:
        raise RowError("source_version が空")

    return {
        "source_version": source_version,
        "muni_code_5": muni_code_5,
        "school_type": school_type,
        # 6桁は CSV の muni_code_6 をそのまま保持（検査数字は計算しない）。
        "muni_code_6": none_if_blank(raw_row.get("muni_code_6")),
        "pref_code": none_if_blank(raw_row.get("pref_code")),
        "muni_name": none_if_blank(raw_row.get("muni_name")),
        "source_type": none_if_blank(raw_row.get("source_type")),
        "source_date": none_if_blank(raw_row.get("source_date")),
        "license_status": normalize_license_status(raw_row.get("license_status")),
        "license_type": none_if_blank(raw_row.get("license_type")),
        "license_url": none_if_blank(raw_row.get("license_url")),
        "source_url": none_if_blank(raw_row.get("source_url")),
        "commercial_use": parse_bool("commercial_use", raw_row.get("commercial_use")),
        "redistribution": parse_bool("redistribution", raw_row.get("redistribution")),
        "attribution_required": parse_bool("attribution_required", raw_row.get("attribution_required")),
        "attribution_text": none_if_blank(raw_row.get("attribution_text")),
        "raw_public": none_if_blank(raw_row.get("raw_public")),
        "raw_use": none_if_blank(raw_row.get("raw_use")),
        "special_condition": none_if_blank(raw_row.get("special_condition")),
        "checked_at": none_if_blank(raw_row.get("checked_at")),
        "is_priority_target": parse_bool_priority(raw_row.get("is_priority_target"), lineno),
    }


def parse_bool_priority(raw: str, lineno: int) -> bool:
    """is_priority_target は NOT NULL DEFAULT false。空は false 扱い。"""
    key = (raw or "").strip()
    if key == "":
        return False
    if key not in BOOL_MAP or BOOL_MAP[key] is None:
        raise RowError(f"is_priority_target: 解釈できない値 '{raw}'")
    return BOOL_MAP[key]


# --- メイン ----------------------------------------------------------------

def load_csv(path: str):
    with open(path, newline="", encoding=CSV_ENCODING) as f:
        reader = csv.DictReader(f)
        header = reader.fieldnames or []
        missing = [c for c in EXPECTED_COLUMNS if c not in header]
        extra = [c for c in header if c not in EXPECTED_COLUMNS]
        if missing:
            raise SystemExit(
                f"CSV の列が不足しています。missing={missing} / extra={extra} / header={header}"
            )
        rows = list(reader)
    return header, rows


def main() -> int:
    args = parse_args()

    log.info("school_district_licenses ローダー開始%s", " [DRY-RUN]" if args.dry_run else "")
    log.info("csv=%s", args.csv)

    header, raw_rows = load_csv(args.csv)
    log.info("CSV 読込: %s 列 / %s 行", len(header), len(raw_rows))

    prepared = []
    skip_reasons = Counter()
    status_counter = Counter()
    # 追加指示2: CLEARED かつ attribution_text 欠損の行を収集。
    cleared_missing_attr = []

    for i, raw in enumerate(raw_rows, start=2):  # 2 = ヘッダの次の行番号
        try:
            row = build_row(raw, i)
        except RowError as exc:
            skip_reasons[str(exc)] += 1
            log.warning("行 %s をスキップ: %s", i, exc)
            continue

        status_counter[row["license_status"]] += 1
        if row["license_status"] == "CLEARED" and not row["attribution_text"]:
            cleared_missing_attr.append((row["muni_code_5"], row["school_type"], row["muni_name"]))

        prepared.append(row)

    # --- レポート出力（dry-run/本実行 共通の事前サマリ）---
    log.info("--- 準備完了サマリ ---")
    log.info("投入予定: %s 件 / スキップ: %s 件", len(prepared), sum(skip_reasons.values()))
    if skip_reasons:
        for reason, n in skip_reasons.most_common():
            log.info("  スキップ理由: %s -> %s 件", reason, n)
    log.info("license_status 内訳: CLEARED=%s / PENDING=%s / REJECTED=%s",
             status_counter.get("CLEARED", 0),
             status_counter.get("PENDING", 0),
             status_counter.get("REJECTED", 0))

    # 追加指示2: CLEARED かつ attribution_text 欠損（= is_public は false になる安全側挙動）。
    log.info("--- attribution_text 欠損チェック（追加指示2）---")
    log.info(
        "license_status=CLEARED かつ attribution_text 空/NULL: %s 件 "
        "（この行は CLEARED でも is_public=false になる。補完はしない）",
        len(cleared_missing_attr),
    )
    if cleared_missing_attr:
        head = cleared_missing_attr[:20]
        for muni, stype, name in head:
            log.info("  欠損: muni_code_5=%s school_type=%s (%s)", muni, stype, name or "")
        if len(cleared_missing_attr) > 20:
            log.info("  ... 他 %s 件（先頭20件のみ表示 / 総数=%s）",
                     len(cleared_missing_attr) - 20, len(cleared_missing_attr))

    if args.dry_run:
        log.info("dry-run 完了: DB へは書き込みません（投入予定=%s 件）", len(prepared))
        return 0

    if not prepared:
        log.warning("投入対象が 0 件のため終了します。")
        return 0

    # --- 冪等 UPSERT（DELETE はしない）---
    sb = get_client()
    written = 0
    for start in range(0, len(prepared), CHUNK_SIZE):
        chunk = prepared[start:start + CHUNK_SIZE]
        sb.table(TABLE).upsert(chunk, on_conflict=ON_CONFLICT).execute()
        written += len(chunk)
        log.info("upsert: %s 件（累計 %s / %s）", len(chunk), written, len(prepared))

    log.info("完了: upsert %s 件 / スキップ %s 件 / "
             "CLEARED=%s PENDING=%s REJECTED=%s / CLEARED-attr欠損=%s 件",
             written, sum(skip_reasons.values()),
             status_counter.get("CLEARED", 0),
             status_counter.get("PENDING", 0),
             status_counter.get("REJECTED", 0),
             len(cleared_missing_attr))
    return 0


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="R5 条件表 CSV を public.school_district_licenses に冪等投入する。"
    )
    p.add_argument("--csv", default="docs/school_district_licenses_r5.csv",
                   help="ライセンス CSV のパス（デフォルト: docs/school_district_licenses_r5.csv）")
    p.add_argument("--dry-run", action="store_true",
                   help="DB へ書き込まず、サマリのみ出力する。")
    return p.parse_args()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        log.error("致命的エラー: %s", exc)
        sys.exit(1)

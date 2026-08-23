#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/etl/load_geo_reference_points.py

M2-5a / SD-31・SD-32(案A): 国土交通省「位置参照情報」の代表点を
public.geo_reference_points に冪等投入する。

方針(案A):
    - ISJ の生フィールド(大字丁目名/小字通称名/街区符号)をそのまま格納し、
      住所正規化・キー分割は一切しない(正規化器の一般化は M2-5b の管轄)。
    - 対象は公開8市のみ。街区(block)は代表フラグ=1 の点のみ。町丁目(town)は全行。
    - 座標は ISJ の十進経緯度をそのまま lat/lon に格納(SRID 4326・geom はDB側 GENERATED)。
    - geom は GENERATED 列のため UPSERT payload に含めない。

8市フィルタ(原則2 = 都道府県違いの同名市を絶対に拾わない):
    - 街区CSVには市区町村コード列が無い → (都道府県名, 市区町村名) の複合キー固定辞書で解決。
    - 町丁目CSVには市区町村コード(5桁)がある → コードで直接フィルタ。
    - どちらも「対象8市のみ」。複合キー/コードに一致しない行は無視(落とす)。

前提/停止条項:
    - ⛔ --dry-run は DB に一切接続しない(ローカルCSVのパース・件数集計のみ)。
    - 本ロード(DB書込み)は PO が service_role で実行する。接続情報は .env.local から読む
      (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY。キーはハードコードしない)。
    - migration 20260816000000_step3_create_geo_reference_points.sql が適用済みであること
      (本ロード時)。dry-run には不要。

使い方:
    # 愛知(既存DLファイル)を dry-run(DB非接続・市区町村別件数):
    python scripts/etl/load_geo_reference_points.py \
        --block-csv /path/to/23000-24.0a.csv \
        --town-csv  /path/to/23000-19.0b.csv \
        --dry-run

    # 鹿児島(手動DL後)を dry-run:
    python scripts/etl/load_geo_reference_points.py \
        --block-csv /path/to/46000-24.0a.csv \
        --town-csv  /path/to/46000-19.0b.csv \
        --dry-run

    # 本投入(PO が実行・県ファイルごとに1回ずつ。冪等 UPSERT なので累積):
    python scripts/etl/load_geo_reference_points.py \
        --block-csv /path/to/23000-24.0a.csv \
        --town-csv  /path/to/23000-19.0b.csv
"""

import argparse
import csv
import logging
import os
import re
import sys
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

TABLE = "geo_reference_points"
ON_CONFLICT = "source_version,level,muni_code_5,town_raw,subarea_raw,block_raw"
LICENSE_URL = "https://nlftp.mlit.go.jp/isj/agreement.html"
CHUNK_SIZE = 500

# ── 対象自治体の固定辞書(複合キー = (都道府県名, 市区町村名) → 5桁コード)──────────────
# 都道府県名を必ず複合キーに含める(原則2: 府中市問題と同型。同名市の誤取り込み防止)。
#
# ⚠ O38: 唯一の正はこの辞書。src/lib/address/target-munis.ts は「同値の転記」。
#    片側だけ直すと突合(match_address_to_geo_point)が静かに 0 件一致になる。両方同時更新。
#
# D135(2026-08-23・9/1 商圏カバレッジ拡張): 既存8 に 愛知6市・名古屋16区・東郷町 を追加。
#   - 名古屋市は【案A＝行政区コード粒度】。ISJ 位置参照情報は政令市を行政区単位で分割し、
#     街区CSVの市区町村名="名古屋市○区" / 町丁目CSVの市区町村コード=区コード(23101〜23116)。
#     市コード 23100 へ丸めず ISJ を忠実格納する(municipalities は 23100 と16区の両方を保持)。
#   - 東郷町は郡名の有無で表記が割れうるため、街区CSVの複合キーは「東郷町」「愛知郡東郷町」の
#     両表記を登録して吸収する(町丁目CSVはコード 23302 でフィルタするため表記非依存)。
#     ⚠ ISJ 実ファイルはリポジトリ外(PO 手動DL)のため実表記を本セッションでは確認できていない。
#       PO は本投入前に --dry-run で 23302 の街区/町丁目件数が出ることを必ず確認すること。
TARGET_MUNIS = {
    # ── 既存8 ─────────────────────────────────────────────────────
    ("愛知県", "豊橋市"): "23201",
    ("愛知県", "岡崎市"): "23202",
    ("愛知県", "刈谷市"): "23210",
    ("愛知県", "豊田市"): "23211",
    ("愛知県", "安城市"): "23212",
    ("愛知県", "知立市"): "23225",
    ("愛知県", "高浜市"): "23227",
    ("鹿児島県", "鹿児島市"): "46201",
    # ── D135 追加: 愛知6市 ────────────────────────────────────────
    ("愛知県", "瀬戸市"): "23204",
    ("愛知県", "西尾市"): "23213",
    ("愛知県", "尾張旭市"): "23226",
    ("愛知県", "岩倉市"): "23228",
    ("愛知県", "北名古屋市"): "23234",
    ("愛知県", "長久手市"): "23238",
    # ── D135 追加: 名古屋市16区(案A・muni_code_5=行政区コード)────────
    ("愛知県", "名古屋市千種区"): "23101",
    ("愛知県", "名古屋市東区"): "23102",
    ("愛知県", "名古屋市北区"): "23103",
    ("愛知県", "名古屋市西区"): "23104",
    ("愛知県", "名古屋市中村区"): "23105",
    ("愛知県", "名古屋市中区"): "23106",
    ("愛知県", "名古屋市昭和区"): "23107",
    ("愛知県", "名古屋市瑞穂区"): "23108",
    ("愛知県", "名古屋市熱田区"): "23109",
    ("愛知県", "名古屋市中川区"): "23110",
    ("愛知県", "名古屋市港区"): "23111",
    ("愛知県", "名古屋市南区"): "23112",
    ("愛知県", "名古屋市守山区"): "23113",
    ("愛知県", "名古屋市緑区"): "23114",
    ("愛知県", "名古屋市名東区"): "23115",
    ("愛知県", "名古屋市天白区"): "23116",
    # ── D135 追加: 東郷町(両表記を吸収)─────────────────────────────
    ("愛知県", "東郷町"): "23302",
    ("愛知県", "愛知郡東郷町"): "23302",
}
TARGET_CODES = set(TARGET_MUNIS.values())  # 町丁目CSV(コード列あり)のフィルタ用

# ── ヘッダ別名(NFKC 正規化して突き合わせ)──────────────────────────────────
H_PREF_NAME = ("都道府県名",)
H_MUNI_NAME = ("市区町村名",)
H_MUNI_CODE = ("市区町村コード",)
H_TOWN_BLOCK = ("大字・丁目名", "大字町丁目名", "大字・町丁目名")  # 街区/町丁目でラベル差
H_SUBAREA = ("小字・通称名",)
H_BLOCK = ("街区符号・地番", "街区符号", "街区地番")
H_LAT = ("緯度",)
H_LON = ("経度",)
H_REP = ("代表フラグ",)


def _norm_header(v: str) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", v))


def _resolve(fieldnames, aliases, *, required, path):
    table = {_norm_header(f): f for f in fieldnames}
    for a in aliases:
        hit = table.get(_norm_header(a))
        if hit is not None:
            return hit
    if required:
        raise SystemExit(f"必須カラムが見つかりません {path}: {' / '.join(aliases)}")
    return None


def _detect_encoding(path: Path) -> str:
    sample = path.read_bytes()[:65_536]
    try:
        sample.decode("utf-8-sig")
        return "utf-8-sig"
    except UnicodeDecodeError:
        try:
            sample.decode("cp932")
            return "cp932"
        except UnicodeDecodeError as e:
            raise SystemExit(f"CSV encoding が UTF-8 でも CP932 でもありません: {path}") from e


def _clean(v) -> str:
    return (v or "").strip()


def _coord(v: str, *, kind: str, path: Path, line: int) -> float:
    try:
        c = float(unicodedata.normalize("NFKC", v).strip())
    except ValueError as e:
        raise SystemExit(f"不正な{kind} {path}:{line}: {v!r}") from e
    lo, hi = (-90.0, 90.0) if kind == "緯度" else (-180.0, 180.0)
    if not lo <= c <= hi:
        raise SystemExit(f"範囲外の{kind} {path}:{line}: {v!r}")
    return c


def _file_ts(path: Path) -> str:
    return (
        datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _derive_source_url(path: Path, version: str) -> str:
    """ファイル名の先頭5桁(県コード5桁)と版から公式ZIPのURLを組み立てる。"""
    m = re.match(r"(\d{5})", path.name)
    if not m:
        return ""
    pref5 = m.group(1)
    return f"https://nlftp.mlit.go.jp/isj/dls/data/{version}/{pref5}-{version}.zip"


def parse_block(path: Path, *, version: str, source_url: str, fetched_at: str,
                source_date, print_fields: bool):
    """街区レベルCSV → payload のイテレータ + 除外カウンタ。"""
    enc = _detect_encoding(path)
    rows = []
    excluded = Counter()
    attribution = f"街区レベル位置参照情報 国土交通省（{version}・{path.name}）加工:エリアスコア"
    with path.open("r", encoding=enc, newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            raise SystemExit(f"CSVヘッダがありません: {path}")
        if print_fields:
            log.info("[block] columns=%s", reader.fieldnames)
            return rows, excluded, attribution
        c_pref = _resolve(reader.fieldnames, H_PREF_NAME, required=True, path=path)
        c_muni = _resolve(reader.fieldnames, H_MUNI_NAME, required=True, path=path)
        c_town = _resolve(reader.fieldnames, H_TOWN_BLOCK, required=True, path=path)
        c_sub = _resolve(reader.fieldnames, H_SUBAREA, required=False, path=path)
        c_block = _resolve(reader.fieldnames, H_BLOCK, required=True, path=path)
        c_lat = _resolve(reader.fieldnames, H_LAT, required=True, path=path)
        c_lon = _resolve(reader.fieldnames, H_LON, required=True, path=path)
        c_rep = _resolve(reader.fieldnames, H_REP, required=False, path=path)
        if c_rep is None:
            log.warning("[block] 代表フラグ列が無い → 全点を代表点として扱います: %s", path)
        for line, row in enumerate(reader, start=2):
            pref = _clean(row.get(c_pref))
            muni = _clean(row.get(c_muni))
            code = TARGET_MUNIS.get((pref, muni))
            if code is None:
                excluded["対象8市外(複合キー不一致)"] += 1
                continue
            if c_rep is not None and _clean(row.get(c_rep)) != "1":
                excluded["代表フラグ≠1"] += 1
                continue
            town_raw = _clean(row.get(c_town))
            if not town_raw:
                excluded["大字丁目名が空"] += 1
                continue
            rows.append({
                "level": "block",
                "muni_code_5": code,
                "pref_code": code[:2],
                "muni_name": muni,
                "town_raw": town_raw,
                "subarea_raw": _clean(row.get(c_sub)) if c_sub else "",
                "block_raw": _clean(row.get(c_block)),
                "lat": _coord(row.get(c_lat) or "", kind="緯度", path=path, line=line),
                "lon": _coord(row.get(c_lon) or "", kind="経度", path=path, line=line),
                "source_type": "MLIT_ISJ_BLOCK",
                "source_version": version,
                "source_date": source_date,
                "source_url": source_url,
                "license_url": LICENSE_URL,
                "attribution_text": attribution,
                "fetched_at": fetched_at,
            })
    return rows, excluded, attribution


def parse_town(path: Path, *, version: str, source_url: str, fetched_at: str,
               source_date, print_fields: bool):
    """大字・町丁目レベルCSV → payload のイテレータ + 除外カウンタ。"""
    enc = _detect_encoding(path)
    rows = []
    excluded = Counter()
    attribution = f"大字・町丁目レベル位置参照情報 国土交通省（{version}・{path.name}）加工:エリアスコア"
    with path.open("r", encoding=enc, newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            raise SystemExit(f"CSVヘッダがありません: {path}")
        if print_fields:
            log.info("[town] columns=%s", reader.fieldnames)
            return rows, excluded, attribution
        c_code = _resolve(reader.fieldnames, H_MUNI_CODE, required=True, path=path)
        c_muni = _resolve(reader.fieldnames, H_MUNI_NAME, required=True, path=path)
        c_town = _resolve(reader.fieldnames, H_TOWN_BLOCK, required=True, path=path)
        c_lat = _resolve(reader.fieldnames, H_LAT, required=True, path=path)
        c_lon = _resolve(reader.fieldnames, H_LON, required=True, path=path)
        for line, row in enumerate(reader, start=2):
            code = _clean(row.get(c_code))
            if code not in TARGET_CODES:
                excluded["対象8市外(コード不一致)"] += 1
                continue
            town_raw = _clean(row.get(c_town))
            if not town_raw:
                excluded["大字町丁目名が空"] += 1
                continue
            rows.append({
                "level": "town",
                "muni_code_5": code,
                "pref_code": code[:2],
                "muni_name": _clean(row.get(c_muni)),
                "town_raw": town_raw,
                "subarea_raw": "",
                "block_raw": "",
                "lat": _coord(row.get(c_lat) or "", kind="緯度", path=path, line=line),
                "lon": _coord(row.get(c_lon) or "", kind="経度", path=path, line=line),
                "source_type": "MLIT_ISJ_TOWN",
                "source_version": version,
                "source_date": source_date,
                "source_url": source_url,
                "license_url": LICENSE_URL,
                "attribution_text": attribution,
                "fetched_at": fetched_at,
            })
    return rows, excluded, attribution


def _natural_key(r):
    return (r["source_version"], r["level"], r["muni_code_5"],
            r["town_raw"], r["subarea_raw"], r["block_raw"])


def dedup(rows):
    """自然キーで重複排除(last-wins)。UNIQUE 制約と同一キー。重複数を返す。"""
    seen = {}
    for r in rows:
        seen[_natural_key(r)] = r
    dropped = len(rows) - len(seen)
    return list(seen.values()), dropped


def report_counts(rows, dropped, label):
    per = Counter()
    for r in rows:
        per[(r["muni_code_5"], r["muni_name"], r["level"])] += 1
    log.info("--- %s: 自治体 × レベル別 件数 ---", label)
    aichi_block = 0
    for (code, name, level), n in sorted(per.items()):
        log.info("  %s %s [%s]: %s 件", code, name, level, n)
        if level == "block" and code.startswith("23"):
            aichi_block += n
    log.info("  重複排除(last-wins): %s 件", dropped)
    log.info("  合計(投入予定): %s 件", len(rows))
    if aichi_block:
        log.info("  参考: 愛知の block 合計 = %s 件（スパイク実測 323,312 と照合）", aichi_block)


def get_client():
    """本投入時のみ。dry-run では呼ばない(DB非接続)。"""
    from dotenv import load_dotenv
    from supabase import create_client
    load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", "..", ".env.local"))
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit(
            "Supabase 接続情報が見つかりません "
            "(.env.local: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)"
        )
    return create_client(url, key)


def run(args) -> int:
    if not args.block_csv and not args.town_csv:
        raise SystemExit("--block-csv と --town-csv の少なくとも一方が必要です。")

    all_rows = []
    all_excluded = Counter()

    if args.block_csv:
        p = Path(args.block_csv).resolve()
        if not p.is_file():
            raise SystemExit(f"--block-csv が存在しません: {p}")
        url = args.block_source_url or _derive_source_url(p, args.block_version)
        fetched = args.fetched_at or _file_ts(p)
        rows, exc, attr = parse_block(
            p, version=args.block_version, source_url=url, fetched_at=fetched,
            source_date=args.source_date, print_fields=args.print_fields)
        log.info("[block] %s: 抽出 %s 件 / source_url=%s / fetched_at=%s",
                 p.name, len(rows), url, fetched)
        log.info("[block] attribution=%s", attr)
        all_rows += rows
        all_excluded += exc
        for reason, n in exc.most_common():
            log.info("  [block] 除外: %s -> %s", reason, n)

    if args.town_csv:
        p = Path(args.town_csv).resolve()
        if not p.is_file():
            raise SystemExit(f"--town-csv が存在しません: {p}")
        url = args.town_source_url or _derive_source_url(p, args.town_version)
        fetched = args.fetched_at or _file_ts(p)
        rows, exc, attr = parse_town(
            p, version=args.town_version, source_url=url, fetched_at=fetched,
            source_date=args.source_date, print_fields=args.print_fields)
        log.info("[town] %s: 抽出 %s 件 / source_url=%s / fetched_at=%s",
                 p.name, len(rows), url, fetched)
        log.info("[town] attribution=%s", attr)
        all_rows += rows
        all_excluded += exc
        for reason, n in exc.most_common():
            log.info("  [town] 除外: %s -> %s", reason, n)

    if args.print_fields:
        return 0

    all_rows, dropped = dedup(all_rows)

    if args.dry_run:
        report_counts(all_rows, dropped, "DRY-RUN(DB非接続)")
        log.info("dry-run 完了: DB へは接続・書込みしません。")
        return 0

    if not all_rows:
        log.warning("投入対象が 0 件のため終了します。")
        return 0

    # 本投入(冪等 UPSERT・geom は送らない=GENERATED)。
    sb = get_client()
    written = 0
    for start in range(0, len(all_rows), CHUNK_SIZE):
        chunk = all_rows[start:start + CHUNK_SIZE]
        sb.table(TABLE).upsert(chunk, on_conflict=ON_CONFLICT).execute()
        written += len(chunk)
        log.info("upsert: %s 件（累計 %s / %s）", len(chunk), written, len(all_rows))
    report_counts(all_rows, dropped, "投入結果")
    log.info("完了: upsert %s 件", written)
    return 0


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="位置参照情報(街区/大字町丁目レベル)を public.geo_reference_points に冪等投入する。")
    p.add_argument("--block-csv", default=None, help="街区レベルCSV(例 23000-24.0a.csv)")
    p.add_argument("--town-csv", default=None, help="大字・町丁目レベルCSV(例 23000-19.0b.csv)")
    p.add_argument("--block-version", default="24.0a", help="街区ファイル版(既定 24.0a=令和7年度)")
    p.add_argument("--town-version", default="19.0b", help="町丁目ファイル版(既定 19.0b=令和7年度)")
    p.add_argument("--block-source-url", default=None, help="街区ZIPの取得元URL(省略時はファイル名から組立)")
    p.add_argument("--town-source-url", default=None, help="町丁目ZIPの取得元URL(省略時はファイル名から組立)")
    p.add_argument("--source-date", default=None, help="整備年度相当(YYYY-MM-DD・任意)")
    p.add_argument("--fetched-at", default=None,
                   help="手動DL日時(ISO8601)。省略時は各CSVの更新日時を記録。")
    p.add_argument("--print-fields", action="store_true", help="実カラム名を表示して終了(DB非接続)")
    p.add_argument("--dry-run", action="store_true",
                   help="⛔DB非接続。ローカルパースと市区町村別件数のみ出力。")
    return p.parse_args()


if __name__ == "__main__":
    try:
        sys.exit(run(parse_args()))
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        log.error("致命的エラー: %s", exc)
        sys.exit(1)

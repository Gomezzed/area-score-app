#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/etl/load_school_districts.py

STEP2 / SD-20・SD-22: 国土数値情報(A27 小学校区 / A32 中学校区)のポリゴンを
public.school_districts に冪等投入する。

前提:
    - 台帳 public.school_district_licenses が先に投入済みであること
      （load_school_district_licenses.py）。投入対象の絞り込みと
       muni_code_6 / pref_code / muni_name の補完を台帳 join で行うため。
    - KSJ ファイルは PO が手動DLして data/ksj/ 等に置く。本 ETL は
      ローカルファイルパスを --input で受ける（DLURL の推測・組み立てはしない）。
    - 測地系 JGD2011(EPSG:6668) → SRID 4326 に変換して投入する。

「版」と「種別」の違い（追加指示5）:
    - --source-version = 国土数値情報 利用条件表の版。既定 R5(=令和5年度版=2023年度版)。
      台帳と (source_version, muni_code_5, school_type) で結合する版キー。データセット種別ではない。
    - --source-type   = データセット種別。KSJ_A27_2023(小) / KSJ_A32_2023(中)。必須。既定を置かない。

使い方:
    # まず実カラム名を確認（DB/書き込みなし）:
    python scripts/etl/load_school_districts.py --input data/ksj/A27-23_23.geojson --print-fields

    # 本投入（例: 愛知の小学校区）:
    python scripts/etl/load_school_districts.py \
        --input data/ksj/A27-23_23.geojson \
        --source-type KSJ_A27_2023 --school-type elementary
    # dry-run（DB へ書かず計画のみ。台帳の読み取りは行う）:
    python scripts/etl/load_school_districts.py ... --dry-run

接続情報は .env.local から読む（キーはハードコードしない）:
    NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
"""

import argparse
import logging
import os
import sys
from collections import Counter, defaultdict

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", "..", ".env.local"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 定数
# ---------------------------------------------------------------------------

TABLE = "school_districts"
LICENSE_TABLE = "school_district_licenses"
ON_CONFLICT = "source_version,muni_code_5,school_type,school_key"

# 測地系: KSJ は JGD2011。CRS 未設定のファイルにはこれを明示設定してから 4326 へ変換。
SRC_CRS_JGD2011 = "EPSG:6668"
DST_SRID = 4326

# データセット種別 × 学校種の整合（追加指示6）。取り違えるとライセンス判定が壊れる。
SOURCE_TYPE_SCHOOL_TYPE = {
    "KSJ_A27_2023": "elementary",
    "KSJ_A32_2023": "junior_high",
}

# 属性名マッピング（追加指示: 実物未取得のため既定値を置かない = 推測値を既定にしない）。
#
# ⚠️ KSJ ファイル（data/ksj/）は 2026-08-14 時点で未取得のため、実カラム名を確認できていない。
#    下記は「置き場」であり、None のままでは ETL は実カラムを表示して中断する。
#    PO は --print-fields で実カラムを確認し、この定数を埋めてから実行すること。
#
# 参考（KSJ 公開仕様の候補。**未検証。既定にはしない**）:
#   A27(小学校区): A27_001=行政区域コード, A27_002=設置主体, A27_003=学校コード,
#                  A27_004=名称, A27_005=所在地（要 実ファイル確認）
#   A32(中学校区): 属性名は未確認（A32_* と推定されるが確認できていない）
#
# logical field -> KSJ カラム名（実ファイルで確認して埋める）。
FIELD_MAP = {
    # 2026-08-14 実測確定（A27-23_23_GML.zip / A32-23_23_GML.zip を --print-fields で確認）。
    # A27 と A32 は同じ並び。001=行政区域コード5桁 / 002=設置主体（名称。表記ゆれあり）/
    # 003=学校コード（小=B・中=C の接頭辞）/ 004=学校名 / 005=所在地。
    # 版が変わったら必ず --print-fields で再確認すること（推測で継承しない）。
    "KSJ_A27_2023": {
        "muni_code_5":      "A27_001",   # 例 '23100'（名古屋市＝区ではなく市コード。SD-14）
        "school_code":      "A27_003",   # 例 'B123210000496'
        "school_name":      "A27_004",   # 例 '南押切小学校'
        "school_address":   "A27_005",   # 例 '名古屋市西区則武新町2-14-3'
        "establisher_code": "A27_002",   # 例 '名古屋市立'（実体は名称。列名に反して数値コードではない）
    },
    "KSJ_A32_2023": {
        "muni_code_5":      "A32_001",   # 例 '23100'
        "school_code":      "A32_003",   # 例 'C123210000635'
        "school_name":      "A32_004",   # 例 '港北中学校'
        "school_address":   "A32_005",   # 例 '名古屋市港区港北町2-1'
        "establisher_code": "A32_002",   # 例 '名古屋市'（A27 は「〜立」付きで表記が揃っていない）
    },
}
# 必須の logical field（これが None、または実ファイルに無ければ中断）。
REQUIRED_LOGICAL_FIELDS = ["muni_code_5", "school_name"]

CHUNK_SIZE = 200


# ---------------------------------------------------------------------------
# ヘルパ
# ---------------------------------------------------------------------------

def get_client() -> Client:
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise ValueError(
            "Supabase の接続情報が見つかりません (.env.local: "
            "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)"
        )
    return create_client(url, key)


def import_geo():
    """geopandas/shapely は重いので、必要時のみ import する。"""
    try:
        import geopandas as gpd  # noqa: F401
        from shapely import make_valid  # noqa: F401
        from shapely.geometry import MultiPolygon  # noqa: F401
        return gpd
    except ImportError as exc:
        raise SystemExit(
            f"geopandas/shapely が未インストールです（pip install -r scripts/requirements.txt）。詳細: {exc}"
        )


def fetch_license_targets(sb: Client, source_version: str, school_type: str):
    """
    台帳から、この (source_version, school_type) の is_priority_target=true の
    muni_code_5 集合と、muni_code_5 -> (muni_code_6, pref_code, muni_name) を返す。
    SD-20: CLEARED/PENDING/REJECTED すべて投入するため license_status では絞らない。
    """
    target_munis = set()
    join_by_muni = {}
    # 台帳から必要列のみ取得（read）。
    resp = (
        sb.table(LICENSE_TABLE)
        .select("muni_code_5,muni_code_6,pref_code,muni_name,is_priority_target")
        .eq("source_version", source_version)
        .eq("school_type", school_type)
        # PostgREST は真偽値を小文字で要求する。Python の True を渡すと
        # URL が is_priority_target=eq.True となり一致しないため、明示的に "true"。
        .eq("is_priority_target", "true")
        .execute()
    )
    for r in resp.data or []:
        m = r["muni_code_5"]
        target_munis.add(m)
        join_by_muni[m] = {
            "muni_code_6": r.get("muni_code_6"),
            "pref_code": r.get("pref_code"),
            "muni_name": r.get("muni_name"),
        }
    return target_munis, join_by_muni


def resolve_field_map(source_type: str, actual_columns):
    """FIELD_MAP を実カラムに突き合わせる。None・未存在があれば中断（推測値を既定にしない）。"""
    fmap = FIELD_MAP.get(source_type)
    if fmap is None:
        raise SystemExit(f"FIELD_MAP に {source_type} の定義がありません。")

    problems = []
    for logical in REQUIRED_LOGICAL_FIELDS:
        col = fmap.get(logical)
        if not col:
            problems.append(f"必須 logical field '{logical}' の KSJ カラム名が未設定(None)")
        elif col not in actual_columns:
            problems.append(f"'{logical}' に設定された '{col}' が実ファイルに存在しない")
    # 任意フィールドも、設定されているのに実在しなければ誤設定として中断。
    for logical, col in fmap.items():
        if logical in REQUIRED_LOGICAL_FIELDS:
            continue
        if col and col not in actual_columns:
            problems.append(f"任意 '{logical}' に設定された '{col}' が実ファイルに存在しない")

    if problems:
        log.error("FIELD_MAP が実ファイルと整合しません（推測値では進めません）:")
        for p in problems:
            log.error("  - %s", p)
        log.error("実ファイルの属性カラム: %s", sorted(actual_columns))
        raise SystemExit(
            "FIELD_MAP を data/ksj の実カラムに合わせて修正してから再実行してください "
            "（--print-fields で確認可）。"
        )
    return fmap


# ---------------------------------------------------------------------------
# メイン処理
# ---------------------------------------------------------------------------

def run(args) -> int:
    gpd = import_geo()
    from shapely import make_valid
    from shapely.geometry import MultiPolygon

    log.info("school_districts ポリゴンETL 開始%s", " [DRY-RUN]" if args.dry_run else "")
    log.info("input=%s source_type=%s school_type=%s source_version=%s",
             args.input, args.source_type, args.school_type, args.source_version)

    # 読込。--print-fields は FIELD_MAP を埋めるための実カラム確認用途であり、
    # --source-type / --school-type を要さない。先にファイルを読み、
    # print-fields ならここで終了する。
    if not os.path.exists(args.input):
        raise SystemExit(f"--input が存在しません: {args.input}")
    gdf = gpd.read_file(args.input)
    log.info("読込: %s features / columns=%s", len(gdf), list(gdf.columns))

    if args.print_fields:
        log.info("--print-fields: 実カラム一覧のみ表示して終了します。")
        for c in gdf.columns:
            sample = gdf[c].iloc[0] if len(gdf) else ""
            log.info("  col=%s 例=%r", c, sample)
        return 0

    # ここから先（実投入・dry-run 含む）は --source-type / --school-type が必須。
    if not args.source_type or not args.school_type:
        raise SystemExit(
            "--source-type と --school-type は（--print-fields 以外では）必須です。"
        )

    # 追加指示6: source_type × school_type の整合を検証（暗黙補正しない）。
    expected_school_type = SOURCE_TYPE_SCHOOL_TYPE.get(args.source_type)
    if expected_school_type is None:
        raise SystemExit(f"未知の --source-type: {args.source_type}")
    if args.school_type != expected_school_type:
        raise SystemExit(
            f"--source-type と --school-type が不整合です: "
            f"{args.source_type} は {expected_school_type} のみ許可（指定 {args.school_type}）。"
        )

    fmap = resolve_field_map(args.source_type, set(gdf.columns))

    # CRS: 未設定なら JGD2011 を明示 → 4326 へ変換。
    if gdf.crs is None:
        log.warning("CRS 未設定 → %s を明示設定します。", SRC_CRS_JGD2011)
        gdf = gdf.set_crs(SRC_CRS_JGD2011)
    gdf = gdf.to_crs(epsg=DST_SRID)

    # 台帳から投入対象(muni_code_5)と join 列を取得（read）。
    sb = get_client()
    target_munis, join_by_muni = fetch_license_targets(
        sb, args.source_version, args.school_type
    )
    log.info("台帳の投入対象(is_priority_target=true, %s, %s): %s 自治体",
             args.source_version, args.school_type, len(target_munis))
    if not target_munis:
        raise SystemExit(
            "台帳に投入対象(is_priority_target=true)が 0 件です。"
            "先に load_school_district_licenses.py を実行してください。"
        )

    # logical field 抽出。
    col_muni = fmap["muni_code_5"]
    col_code = fmap.get("school_code")
    col_name = fmap["school_name"]
    col_addr = fmap.get("school_address")
    col_est = fmap.get("establisher_code")

    def sval(row, col):
        if not col:
            return None
        v = row.get(col)
        if v is None:
            return None
        s = str(v).strip()
        return s if s else None

    # 投入対象の絞り込み（SD-20: 対象自治体のみ）。
    excluded = Counter()
    kept_rows = []
    for _, row in gdf.iterrows():
        muni = sval(row, col_muni)
        if not muni:
            excluded["muni_code_5 が空"] += 1
            continue
        if muni not in target_munis:
            excluded["対象外自治体(is_priority_target=false or 台帳に無し)"] += 1
            continue
        kept_rows.append(row)

    log.info("絞り込み後: %s features（除外 %s 件）", len(kept_rows), sum(excluded.values()))
    for reason, n in excluded.most_common():
        log.info("  除外: %s -> %s 件", reason, n)

    # SD-22: 1学校1行に統合（school_key で dissolve / ST_Union）。
    # school_key = coalesce(nullif(school_code,''), school_name)。
    groups = defaultdict(list)      # (muni, school_key) -> [geometries]
    meta = {}                       # (muni, school_key) -> attrs
    for row in kept_rows:
        muni = sval(row, col_muni)
        code = sval(row, col_code)
        name = sval(row, col_name)
        school_key = code if code else name
        # 案A: school_name(DB は NOT NULL) が空の地物はスキップする。
        # school_code だけ有る地物は school_key が code で埋まり下の空チェックを
        # 素通りするため、ここで明示的に弾かないと本実行の upsert で NOT NULL 違反
        # になる（--dry-run は列の存在のみ検証し行値を見ないため気づけない。実例:
        # 46222 奄美市の A32 で A32_003 有り・A32_004 空の1件）。
        if not name:
            j = join_by_muni.get(muni, {})
            log.warning(
                "校名欠損でスキップ: muni_code_5=%s muni_name=%s school_type=%s school_key=%s",
                muni, (j.get("muni_name") or ""), args.school_type, (school_key or "(空)"),
            )
            excluded["校名欠損(school_name 空)"] += 1
            continue
        if not school_key:
            excluded["school_key が空(school_code/school_name 双方欠損)"] += 1
            continue
        key = (muni, school_key)
        groups[key].append(row.geometry)
        if key not in meta:
            meta[key] = {
                "school_code": code,
                "school_name": name,
                "school_address": sval(row, col_addr),
                "establisher_code": sval(row, col_est),
                "school_key": school_key,
            }

    # 統合・検証・正規化。
    from shapely.ops import unary_union
    makevalid_count = 0
    prepared = []
    per_muni_count = Counter()      # (muni, school_type) -> 投入件数
    for (muni, school_key), geoms in groups.items():
        geom = unary_union(geoms)               # ST_Union 相当（dissolve）
        if not geom.is_valid:                   # ST_IsValid
            geom = make_valid(geom)             # ST_MakeValid
            makevalid_count += 1
        # ST_Multi 相当: MultiPolygon に正規化。
        if geom.geom_type == "Polygon":
            geom = MultiPolygon([geom])
        elif geom.geom_type == "MultiPolygon":
            pass
        elif geom.geom_type in ("GeometryCollection",):
            polys = [g for g in geom.geoms if g.geom_type in ("Polygon", "MultiPolygon")]
            if not polys:
                excluded["MakeValid 後にポリゴンが残らない"] += 1
                continue
            geom = MultiPolygon(
                [p for g in polys for p in (g.geoms if g.geom_type == "MultiPolygon" else [g])]
            )
        else:
            excluded[f"非ポリゴン形状({geom.geom_type})"] += 1
            continue

        j = join_by_muni.get(muni, {})
        m = meta[(muni, school_key)]
        prepared.append({
            "muni_code_5": muni,
            # muni_code_6/pref_code/muni_name は台帳から join して埋める（自前計算しない）。
            "muni_code_6": j.get("muni_code_6"),
            "pref_code": j.get("pref_code"),
            "muni_name": j.get("muni_name"),
            "school_type": args.school_type,
            "school_code": m["school_code"],
            "school_name": m["school_name"],
            "school_address": m["school_address"],
            "establisher_code": m["establisher_code"],
            # EWKT で投入（PostGIS geometry 入力関数が SRID 付きテキストを受ける）。
            "geom": f"SRID={DST_SRID};{geom.wkt}",
            "source_type": args.source_type,
            "source_version": args.source_version,
            # ライセンス列は BEFORE トリガーが台帳から写す（ここでは送らない=DEFAULT+トリガー）。
        })
        per_muni_count[(muni, args.school_type)] += 1

    log.info("統合後: %s 件 / MakeValid 適用: %s 件", len(prepared), makevalid_count)

    if args.dry_run:
        log.info("--- dry-run: 自治体 × school_type 別 投入予定件数（追加指示7）---")
        report_per_muni(per_muni_count, join_by_muni, target_munis,
                        args.source_version, args.school_type, sb, prepared, dry=True)
        # 本実行前に必ず気づけるよう、除外内訳（校名欠損スキップ含む）を dry-run でも出す。
        for reason, n in excluded.most_common():
            log.info("  除外内訳: %s -> %s 件", reason, n)
        log.info("dry-run 完了: DB へは書き込みません（投入予定=%s 件）", len(prepared))
        return 0

    if not prepared:
        log.warning("投入対象が 0 件のため終了します。")
        return 0

    # 冪等 UPSERT（DELETE はしない）。BEFORE トリガーがライセンス列を写す。
    written = 0
    for start in range(0, len(prepared), CHUNK_SIZE):
        chunk = prepared[start:start + CHUNK_SIZE]
        sb.table(TABLE).upsert(chunk, on_conflict=ON_CONFLICT).execute()
        written += len(chunk)
        log.info("upsert: %s 件（累計 %s / %s）", len(chunk), written, len(prepared))

    # 追加指示7: 自治体 × school_type 別に、投入件数と「台帳一致(ライセンス列が写ったか)」を出力。
    log.info("--- 投入結果: 自治体 × school_type 別（追加指示7）---")
    report_per_muni(per_muni_count, join_by_muni, target_munis,
                    args.source_version, args.school_type, sb, prepared, dry=False)

    log.info("完了: upsert %s 件 / MakeValid %s 件 / 除外 %s 件",
             written, makevalid_count, sum(excluded.values()))
    for reason, n in excluded.most_common():
        log.info("  除外内訳: %s -> %s 件", reason, n)
    return 0


def report_per_muni(per_muni_count, join_by_muni, target_munis,
                    source_version, school_type, sb, prepared, dry):
    """
    自治体 × school_type ごとに投入件数と「ライセンス列が写ったか」を出力。
    - dry=True : 台帳に一致行があるか（トリガーが写す見込みか）を予測表示。
    - dry=False: 投入後の実データを再取得し、license_status/is_public を集計して表示。
    """
    munis = sorted({m for (m, _t) in per_muni_count.keys()})

    if dry:
        # 台帳に (source_version, muni, school_type) の行があるかを確認（トリガー一致の予測）。
        resp = (
            sb.table(LICENSE_TABLE)
            .select("muni_code_5,license_status")
            .eq("source_version", source_version)
            .eq("school_type", school_type)
            .in_("muni_code_5", munis or [""])
            .execute()
        )
        lic_by_muni = {r["muni_code_5"]: r["license_status"] for r in (resp.data or [])}
        for m in munis:
            cnt = per_muni_count[(m, school_type)]
            name = (join_by_muni.get(m) or {}).get("muni_name") or ""
            status = lic_by_muni.get(m)
            match = "一致(トリガーが写す見込み)" if status is not None else "★台帳に一致行なし→deny-by-default(PENDING)"
            log.info("  %s %s [%s]: 投入予定 %s 件 / 台帳 %s (license_status=%s)",
                     m, name, school_type, cnt, match, status)
        return

    # 本実行後: 実データを再取得し、台帳の license_status と突き合わせて「写ったか」を判定。
    # 名古屋のように正当に PENDING の自治体もあるため、status!=PENDING では判定しない。
    # 台帳の期待値と DB の実値が一致していれば「トリガーが写した」と判定する。
    lic_resp = (
        sb.table(LICENSE_TABLE)
        .select("muni_code_5,license_status,commercial_use")
        .eq("source_version", source_version)
        .eq("school_type", school_type)
        .in_("muni_code_5", munis or [""])
        .execute()
    )
    expected = {r["muni_code_5"]: r["license_status"] for r in (lic_resp.data or [])}

    for m in munis:
        cnt = per_muni_count[(m, school_type)]
        name = (join_by_muni.get(m) or {}).get("muni_name") or ""
        resp = (
            sb.table(TABLE)
            .select("license_status,is_public")
            .eq("source_version", source_version)
            .eq("muni_code_5", m)
            .eq("school_type", school_type)
            .execute()
        )
        rows = resp.data or []
        statuses = Counter(r["license_status"] for r in rows)
        pub = sum(1 for r in rows if r.get("is_public"))
        exp = expected.get(m)
        # 台帳一致 = DB の全行の license_status が台帳の期待値と一致（＝トリガーが写した）。
        if exp is None:
            wrote = "★台帳に期待行なし→トリガー未一致の可能性(要確認)"
        elif set(statuses) == {exp}:
            wrote = f"写った(台帳期待={exp} と一致)"
        else:
            wrote = f"★不一致: 台帳期待={exp} だが DB={dict(statuses)}（トリガー未発火の可能性・要確認）"
        log.info("  %s %s [%s]: 投入 %s 件 / DB %s 行 / is_public=%s 件 / status=%s / トリガー: %s",
                 m, name, school_type, cnt, len(rows), pub, dict(statuses), wrote)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="KSJ 学校区ポリゴン(A27/A32)を public.school_districts に冪等投入する。"
    )
    p.add_argument("--input", required=True,
                   help="ローカルの Shapefile/GeoJSON/zip パス（KSJ は PO が手動DLして配置）")
    # 追加指示6: --source-type は既定を置かず、実投入時は必須（取り違え防止）。
    # ただし --print-fields（実カラム確認）では不要なため argparse では required にせず、
    # run() 内で print-fields 以外のときに必須チェックする。
    p.add_argument("--source-type", default=None,
                   choices=sorted(SOURCE_TYPE_SCHOOL_TYPE.keys()),
                   help="データセット種別（実投入では必須・既定なし）: "
                        "KSJ_A27_2023(小) / KSJ_A32_2023(中)。--print-fields 時は省略可")
    p.add_argument("--school-type", default=None,
                   choices=["elementary", "junior_high"],
                   help="学校種（実投入では必須）。--source-type と整合しない場合はエラー終了。"
                        "--print-fields 時は省略可")
    # --source-version は既定 R5 でよい（利用条件表の版。台帳と結合する版キー）。
    p.add_argument("--source-version", default="R5",
                   help="利用条件表の版（既定 R5=令和5年度版）。台帳の source_version と結合する版キー")
    p.add_argument("--print-fields", action="store_true",
                   help="実ファイルの属性カラム名を表示して終了（FIELD_MAP を埋めるための確認用）")
    p.add_argument("--dry-run", action="store_true",
                   help="DB へ書き込まず計画のみ出力（台帳の読み取りは行う）")
    return p.parse_args()


if __name__ == "__main__":
    try:
        sys.exit(run(parse_args()))
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        log.error("致命的エラー: %s", exc)
        sys.exit(1)

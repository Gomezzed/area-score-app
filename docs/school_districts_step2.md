# STEP2：学校区レイヤー（school_districts / school_district_licenses）

> 本ドキュメントは STEP2（スキーマ作成 + A27/A32 ETL）の設計と運用を記す。
> STEP3（反響データ拡張・校区判定）／STEP4（地図UI）には踏み込まない。

## 1. 全体像

小学校区（国土数値情報 A27・2023年度版）／中学校区（同 A32・2023年度版）のポリゴンを、
ライセンス台帳と紐付けて `public.school_districts` に投入する。
**許諾が確認できたポリゴン（`is_public = true`）だけを** API/タイルに出す。

- 正のライセンス判定 = R5 条件表由来 CSV（`docs/school_district_licenses_r5*.csv`、PR #38）。
- 判定単位は **`muni_code_5 × school_type`**（自治体単位でゲートすると誤公開する）。
- 条件表に**行が無い自治体は deny-by-default**（PENDING / 非公開）。補完しない。

テーブルは 2 つ：

| テーブル | 役割 | 到達権限 |
|---|---|---|
| `public.school_district_licenses` | ライセンス台帳（R5条件表由来） | RLS有効・ポリシー無し = **service_role のみ** |
| `public.school_districts` | ポリゴン本体（ライセンス列を台帳から非正規化） | authenticated は **`is_public=true` の行のみ** SELECT 可 |

## 2. `source_version` と `source_type` の違い（重要）

この 2 列はしばしば混同されるが、**別概念**である。

| 列 | 意味 | 値の例 |
|---|---|---|
| `source_version` | **国土数値情報 利用条件表の版** | `R5`（=令和5年度版=2023年度版） |
| `source_type` | **データセット種別** | `KSJ_A27_2023`（小） / `KSJ_A32_2023`（中） |

- 台帳とポリゴンは **`(source_version, muni_code_5, school_type)` で結合**する。
  したがって両テーブルの `source_version` は**同じ版キー（`R5`）**でなければ紐付かない。
- CSV の `source_version` は `R5`。ETL の `--source-version` 既定も `R5`。
  **データセット種別（KSJ_A27…）を `source_version` に入れてはならない**（紐付かず全非公開になる）。
- **版が更新された場合（R6 等）は、旧判定を自動継承しない。**
  新しい条件表 CSV を作り直し、`source_version='R6'` の行として台帳へ投入し、
  ポリゴンも `--source-version R6` で再投入して**新条件表で再評価**する。
  （台帳 PK に `source_version` を含めているため、旧版の判定はそのまま残り、混ざらない。）

## 3. `is_public`（最大の安全装置）

`school_districts.is_public` は **生成列（GENERATED ALWAYS … STORED）**。式は：

```
is_public = (
      commercial_use = true
  AND license_status = 'CLEARED'
  AND (attribution_required = false OR attribution_text IS NOT NULL)
)
```

- 入力 3 列（`commercial_use` / `redistribution` / `attribution_required`）は **NOT NULL + 安全側デフォルト**
  （`false` / `false` / `true`）。よって NULL 伝播は起きない。
- `attribution_required` は R5 条件表では全行 `true`。したがって公開には
  **`attribution_text IS NOT NULL` が必須**。CLEARED でも `attribution_text` が空なら
  `is_public=false`（安全側の意図した挙動）。**空欄を勝手に補完してはならない。**
- RLS の SELECT ポリシーは `USING (is_public = true)`。`is_public=false` の行は
  **API レスポンスにもタイルにも一切含まれない。**

## 4. ライセンス列の同期（トリガー2本）

- `sync_school_district_license()`（BEFORE INSERT/UPDATE ON school_districts）
  台帳を `(source_version, muni_code_5, school_type)` で引き、ライセンス列を写す。
  **台帳に行が無ければ写さず DEFAULT のまま（PENDING）** = deny-by-default。例外は投げず NOTICE のみ。
- `propagate_school_district_license()`（AFTER UPDATE ON school_district_licenses）
  台帳更新を該当ポリゴン行へ伝播。**SD-15：許諾が取れたら台帳の `license_status` を
  更新するだけで、`is_public` が自動追随して即日公開**される。

両関数とも `SECURITY DEFINER` / `search_path = public, pg_temp` / **anon に EXECUTE 無し**。

## 5. インデックス / RLS / 権限

- GIST(`geom`) / btree(`muni_code_5, school_type`) / partial(`muni_code_5, school_type`) WHERE `is_public`。
- `school_districts`：RLS 有効。authenticated は SELECT（`is_public=true` のみ）。
  INSERT/UPDATE/DELETE ポリシー無し = 投入は **service_role の ETL のみ**。anon に GRANT 無し。
- `school_district_licenses`：RLS 有効・ポリシー無し = **service_role のみ**。anon/authenticated に GRANT 無し。
- ⚠️ **プラン制限（Platinum 限定）は本 STEP2 の migration には入れていない。**
  API 層 `guardFeature(...)` と STEP4 で追加する。本テーブルは公開/非公開の遮断（`is_public`）のみ担う。

## 6. ETL の実行手順（PO）

### 6-1. 台帳ローダー（先に実行）

```
# dry-run（DB 非書き込み。件数と attribution 欠損を確認）
python scripts/etl/load_school_district_licenses.py --csv docs/school_district_licenses_r5.csv --dry-run
# 本実行
python scripts/etl/load_school_district_licenses.py --csv docs/school_district_licenses_r5.csv
```

- CSV は **BOM 付き**のため `utf-8-sig` で読む（コード内コメント参照）。
- 真偽値は明示マッピングで解釈。表に無い値は例外（暗黙 false にしない）。
- `school_type` は `elementary`/`junior_high`/`compulsory` 以外なら例外。
- 完了レポートに **CLEARED かつ `attribution_text` 欠損の件数と内訳**を出す
  （その行は CLEARED でも `is_public=false`。補完はしない）。

### 6-2. ポリゴン ETL（台帳投入後）

> **KSJ ファイルは PO が手動DLして `data/ksj/` 等に置く。**DL URL は推測・組み立てしない。
> 2026-08-14 時点で KSJ 未取得のため、`scripts/etl/load_school_districts.py` の
> **`FIELD_MAP` は空（None）**。まず実カラムを確認して埋めること（推測値を既定にしない）。

```
# (1) 実ファイルの属性カラム名を確認して FIELD_MAP を埋める
python scripts/etl/load_school_districts.py --input data/ksj/<A27ファイル> --print-fields
#     → 出力の col=... を見て FIELD_MAP['KSJ_A27_2023'] の muni_code_5/school_name 等を設定

# (2) dry-run（DB へ書かず、対象自治体・統合件数・台帳一致見込みを確認）
python scripts/etl/load_school_districts.py \
    --input data/ksj/<A27ファイル> --source-type KSJ_A27_2023 --school-type elementary --dry-run

# (3) 本実行（小学校区）
python scripts/etl/load_school_districts.py \
    --input data/ksj/<A27ファイル> --source-type KSJ_A27_2023 --school-type elementary

# (4) 中学校区（A32）。--source-type / --school-type は必須・取り違え防止で整合チェックあり
python scripts/etl/load_school_districts.py \
    --input data/ksj/<A32ファイル> --source-type KSJ_A32_2023 --school-type junior_high
```

- `--source-type` は**必須・既定なし**。`--school-type` と整合しなければ即エラー
  （`KSJ_A27_2023→elementary` / `KSJ_A32_2023→junior_high` のみ許可）。
- CRS 未設定なら `EPSG:6668`(JGD2011) を明示 → `4326` へ変換。
- **SD-20：優先11自治体（is_priority_target=true）はすべて投入**（CLEARED/PENDING/REJECTED とも）。
  PENDING/REJECTED は `is_public=false` で不可視。
- **SD-22：`school_key` で 1学校1行に統合**（dissolve / union）。`ST_MakeValid` → `ST_Multi` で正規化。
- `muni_code_6`/`pref_code`/`muni_name` は**台帳から join** して埋める（自前計算しない）。
- 完了ログに **自治体 × school_type 別の投入件数と「台帳一致（トリガーが写ったか）」**を出す。

## 7. 検証

`scripts/sql/step2_verify.sql`（SELECT のみ）を PM/PO が実行：
不正ジオメトリ0件 / SRID=4326のみ / MULTIPOLYGONのみ / `is_public=true` が上記8市のみ /
名古屋・一宮・豊川が非公開 / 台帳とポリゴンの license_status 突き合わせ。

## 8. 必須クレジット・免責文言（STEP4 地図で常設）

**必須クレジット文言（年度を含め、一言一句そのまま転記）：**

> 本サービスの学校区データは、国土数値情報（小学校区・中学校区データ、2023年度）を
> （自社名）が加工・編集して作成したものです。

**免責文言（地図フッター常設・STEP4 で使用）：**

> 通学区域は変更される場合があり、番地単位で境界と異なることがあります。
> 実際の指定校は各市区町村の教育委員会にご確認ください。

## 9. 版更新時の運用（再掲）

- **旧判定を自動継承しない。** 新しい利用条件表（例 R6）が出たら、新 CSV を作成し
  `source_version='R6'` として台帳・ポリゴンを再投入し、新条件表で再評価する。
- 台帳 PK と ポリゴン UNIQUE に `source_version` を含めているため、
  旧版（R5）と新版（R6）の行は別レコードとして共存し、判定が混ざらない。

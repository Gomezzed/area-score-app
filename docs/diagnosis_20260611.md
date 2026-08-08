診断レポート 2026-06-11 再実行版
対象DB: bstohiamtnlgcjulgedy
(area-score-app / ap-southeast-1)
モード: 読み取り専用
(修正/migration/書込は未実施)


■ 結論(1行)
42703エラーは解消済み。
解消方式は B(DBカラム追加)。


────────────────────
1. 42703エラーの解消状況
────────────────────
状態: 解消済み。
方式: B(DBにカラムを追加)。
根拠:
useCensus.ts は今も
station_passengers_total を
select している(コードは
変更されていない)。
一方DB側で
municipalities に同名カラムが
bigint NOT NULL DEFAULT 0
として存在する。
追加元 migration:
20260610120000_add_reinfolib_
stations.sql
よってコード修正(A)ではなく
カラム追加(B)で解消した。


────────────────────
2. コード参照 × DB実在カラム
────────────────────
コード参照箇所:
- src/hooks/useCensus.ts:48
  interface 定義
- src/hooks/useCensus.ts:62
  .select(...) 文
- src/hooks/useCensus.ts:89
  stationPassengersTotal へ
  マッピング
- src/types/index.ts:53
  型定義(任意)

DB実在カラム:
municipalities.
station_passengers_total
型: bigint
NOT NULL DEFAULT 0
判定: 参照名とDB名は一致。
不整合なし。


────────────────────
3. stations テーブル
────────────────────
総行数: 9306
都道府県: 47 / 47 全て存在
(コード 01〜47 すべて有)
最新乗降客数の年: 2023
municipality_id 未解決:
0 件(全駅が市区町村に紐付く)
全国投入: 完走済みと判断。

集約値の反映:
station_passengers_total が
0 超の市区町村: 1492
(municipalities 総数 1916 の
約 78%。駅の無い町村が残りで
正常)


────────────────────
4. マンション取引テーブル
────────────────────
現状、関連テーブルは3つ存在。
うち「マンション名を持つ正式な
明細取引テーブル」は
trade_history。

(4-1) real_estate_transactions
役割: 集約(市区町村×年×四半期)
総行数: 2908
投入都道府県: 47 / 47
(01〜47 すべて)
マンション名カラム: 無し
主なカラム:
id, municipality_id,
prefecture_code, city_code,
year, quarter,
transaction_count,
avg_price_man_yen,
avg_price_per_sqm,
avg_area_sqm, created_at
備考: UI(useTransactions)が
実際に参照するのはこの表。

(4-2) trade_history
役割: 明細取引履歴。
マンション名・間取り・建築年・
構造を保持。名寄せ対象。
総行数: 0(空)
投入都道府県: 0(無し)
マンション名カラム: 有り
- mansion_name_raw
- mansion_name_resolved
- mansion_id(名寄せ先)
主なカラム:
id, prefecture_code,
city_code, city_name,
town_name, chome,
traded_year, traded_quarter,
traded_price, price_per_sqm,
area_sqm, layout,
building_year, structure,
property_type,
mansion_name_raw, mansion_id,
mansion_name_resolved,
resolution_status,
resolution_confidence,
resolution_candidates,
resolution_log, resolved_at,
resolved_by, source,
raw_payload, created_at,
updated_at

(4-3) mansion_master
役割: 正規マンションマスター
(名寄せ突合先)。
総行数: 0(空)
投入都道府県: 0(無し)
マンション名カラム: 有り(name,
normalized_name)
主なカラム:
id, prefecture_code,
city_code, town_id, name,
normalized_name, address,
town_name, chome, banchi,
building_year, structure,
total_units, total_floors,
lat, lng, source,
confidence, raw_payload,
created_at, updated_at


────────────────────
5. 不整合と修正方針(未実行)
────────────────────
不整合A: スキーマ・ドリフト。
trade_history と mansion_master
は DB に存在するが、repo の
supabase/migrations 配下に
定義ファイルが無く、src/ にも
参照が無い。別経路で作成され、
コミットされていない。

不整合B: 設計判断の矛盾。
20260610120000 の NOTE は
「明細テーブルは作らず
real_estate_transactions を
再利用する」と明記。しかし
後から trade_history /
mansion_master が作られており
文書上の決定と食い違う。

不整合C: データ未投入。
明細とマスターは 0 行。
マンション名を出す機能は
データが無く未稼働。
集約表(real_estate_
transactions)にはマンション名
カラムが無いため、現データでは
マンション名表示は不可能。

修正方針の選択肢:

方針1: ドリフトを正式採用。
trade_history /
mansion_master を写した
migration をコミットし、その後
ローダで投入する。
メリット: 明細・名寄せ設計を
活かせる。将来の物件単位機能に
対応。
デメリット: ローダ実装と名寄せ
運用が必要。取引モデルが2系統
併存し複雑化。

方針2: 明細を廃止し集約に一本化
(当初 NOTE の方針へ回帰)。
trade_history /
mansion_master を削除し
real_estate_transactions のみ
使う。
メリット: 最も単純。コミット
済み設計・既存UIと一致。
デメリット: マンション名機能を
断念。

方針3: ドリフトだけ先に解消。
現状を写す migration を
コミットし、投入は後日に保留。
メリット: 低リスクで repo と
DB を一致させられる。
デメリット: 空テーブルが残り、
機能未稼働の状態は続く。

推奨は方針判断が必要なため
ここでは実行しない。
要件(マンション名表示の要否)
を確認の上で1〜3を選択のこと。


────────────────────
付記: 確認した生値
────────────────────
- stations 総数 9306 / 47県
- 乗降客数 0超 muni 1492/1916
- real_estate_transactions
  2908 行 / 47県
- trade_history 0 行
- mansion_master 0 行
- station_passengers_total
  カラム実在(bigint)
以上

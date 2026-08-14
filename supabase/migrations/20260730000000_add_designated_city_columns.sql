-- =====================================================================
-- 20260730000000_add_designated_city_columns.sql
-- エンタイトルメント v3 / スキーマ + バックフィル（1本目）
--
-- 目的:
--   Free プラン閲覧ルール v3（政令市ルール）を DB 側で判定するための
--   構造列を municipalities に追加し、本番実コードでバックフィルする。
--     - is_designated_city : 政令指定都市「本体」行か（20市）
--     - parent_city_code   : 政令市の行政区 → 親政令市本体の city_code（175区）
--   東京23特別区（13101〜13123）は親の「本体」行が存在しないため
--   parent_city_code は NULL のまま（RPC 側でコード範囲により特別区グループ扱い）。
--
-- 原則2（コードを背骨に）: すべて city_code（5桁）で判定・更新する。
--   市区町村名は UPDATE / JOIN / 判定キーに使わない。
--   本 migration のコードは、本番への読み取り専用 SELECT で確定した実コードを
--   ハードコードしている（偵察 2026-07-30 / ref bstohiamtnlgcjulgedy）。
--
-- ⚠ 偵察で判明した重要事項（当初案からの是正）:
--   当初案 parent_city_code = left(city_code,3) || '00' は、同一県に複数の
--   政令市がある5県で「誤った親」に解決してしまう（コードは存在するが親が違う）:
--     川崎(14130)/相模原(14150) の区 → 14100 横浜に誤解決
--     浜松(22130) の区 → 22100 静岡 / 堺(27140) の区 → 27100 大阪
--     福岡(40130) の区 → 40100 北九州
--   （left(3)||'00' が誤りとなる区は 川崎7+相模原3+浜松7+堺7+福岡7 = 31区）
--   本 migration では「同一2桁県内で city_code 以下の最大の政令市本体コード」を
--   親とする。実データ175区すべてがこの規則で正しい親に一致することを
--   読み取り専用 SELECT で検証済み（mismatch=0）。
--
-- 冪等性: 列追加は IF NOT EXISTS。バックフィルは毎回リセット→再計算で再現可能。
--         末尾の DO ブロックが件数不整合を検知した場合はトランザクションを中断する。
-- =====================================================================

BEGIN;

-- ── 1. 列追加 ───────────────────────────────────────────────────────
ALTER TABLE public.municipalities
  ADD COLUMN IF NOT EXISTS is_designated_city boolean NOT NULL DEFAULT false;
ALTER TABLE public.municipalities
  ADD COLUMN IF NOT EXISTS parent_city_code text NULL;

-- 再適用時の再現性のため一旦リセット（初回適用時は既定値のままで無害）
UPDATE public.municipalities
SET is_designated_city = false, parent_city_code = NULL
WHERE is_designated_city IS DISTINCT FROM false
   OR parent_city_code IS NOT NULL;

-- ── 2. 政令指定都市 本体20市（実コードをハードコード / 名前不使用） ────────
UPDATE public.municipalities
SET is_designated_city = true
WHERE city_code IN (
  '01100', -- 札幌市
  '04100', -- 仙台市
  '11100', -- さいたま市
  '12100', -- 千葉市
  '14100', -- 横浜市
  '14130', -- 川崎市
  '14150', -- 相模原市
  '15100', -- 新潟市
  '22100', -- 静岡市
  '22130', -- 浜松市
  '23100', -- 名古屋市
  '26100', -- 京都市
  '27100', -- 大阪市
  '27140', -- 堺市
  '28100', -- 神戸市
  '33100', -- 岡山市
  '34100', -- 広島市
  '40100', -- 北九州市
  '40130', -- 福岡市
  '43100'  -- 熊本市
);

-- ── 3. 政令市の行政区175行 → 親政令市本体コードをバックフィル ────────────
--   区の判定（名前不使用）: city_code の左3桁が政令市本体の左3桁ブロックに
--     一致し、かつ本体自身ではない行（実データで175行＝名称ベースの区集合と完全一致）。
--   親の決定: 同一2桁県内で city_code 以下の最大の政令市本体コード。
WITH bodies(body_code) AS (
  VALUES ('01100'),('04100'),('11100'),('12100'),('14100'),('14130'),('14150'),
         ('15100'),('22100'),('22130'),('23100'),('26100'),('27100'),('27140'),
         ('28100'),('33100'),('34100'),('40100'),('40130'),('43100')
),
body_blocks AS (SELECT DISTINCT left(body_code, 3) AS blk FROM bodies)
UPDATE public.municipalities w
SET parent_city_code = (
  SELECT max(b.body_code)
  FROM bodies b
  WHERE left(b.body_code, 2) = left(w.city_code, 2)
    AND b.body_code <= w.city_code
)
WHERE left(w.city_code, 3) IN (SELECT blk FROM body_blocks)
  AND w.city_code NOT IN (SELECT body_code FROM bodies);

-- ── 4. バックフィル健全性チェック（不整合ならトランザクション中断） ────────
DO $$
DECLARE
  v_bodies        int;
  v_wards         int;
  v_bad_parent    int;
  v_pref_mismatch int;
BEGIN
  SELECT count(*) INTO v_bodies FROM public.municipalities WHERE is_designated_city;
  SELECT count(*) INTO v_wards  FROM public.municipalities WHERE parent_city_code IS NOT NULL;

  -- 親が「政令市本体」に解決しない区（あってはならない）
  SELECT count(*) INTO v_bad_parent
  FROM public.municipalities w
  WHERE w.parent_city_code IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.municipalities p
      WHERE p.city_code = w.parent_city_code AND p.is_designated_city
    );

  -- 区と親で県コード（左2桁）が食い違う区（あってはならない）
  SELECT count(*) INTO v_pref_mismatch
  FROM public.municipalities w
  WHERE w.parent_city_code IS NOT NULL
    AND left(w.parent_city_code, 2) <> left(w.city_code, 2);

  IF v_bodies <> 20 THEN
    RAISE EXCEPTION 'entitlement-v3 backfill: designated bodies = % (expected 20)', v_bodies;
  END IF;
  IF v_wards <> 175 THEN
    RAISE EXCEPTION 'entitlement-v3 backfill: wards = % (expected 175)', v_wards;
  END IF;
  IF v_bad_parent <> 0 THEN
    RAISE EXCEPTION 'entitlement-v3 backfill: wards with unresolved parent = % (expected 0)', v_bad_parent;
  END IF;
  IF v_pref_mismatch <> 0 THEN
    RAISE EXCEPTION 'entitlement-v3 backfill: ward/parent prefecture mismatch = % (expected 0)', v_pref_mismatch;
  END IF;
END $$;

-- ── 5. 索引 ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_municipalities_parent_city_code
  ON public.municipalities (parent_city_code);
CREATE INDEX IF NOT EXISTS idx_municipalities_pref_designated
  ON public.municipalities (prefecture_code, is_designated_city);

COMMENT ON COLUMN public.municipalities.is_designated_city IS
  '政令指定都市の本体行か（20市）。Free 閲覧ルール v3 の判定に使用。';
COMMENT ON COLUMN public.municipalities.parent_city_code IS
  '政令市の行政区(175区)→親政令市本体の city_code。東京23特別区は NULL（親行なし・RPCでコード範囲判定）。';

COMMIT;

-- =====================================================================
-- 検証クエリ（適用後に手動実行 / PR 証跡）
-- ---------------------------------------------------------------------
-- (V1) 政令市本体 = 20行:
--   SELECT count(*) FROM public.municipalities WHERE is_designated_city;  -- 期待 20
--
-- (V2) 政令市ごとの区件数（浜松は実データ7区。2024年再編の3区は未反映）:
--   SELECT parent_city_code, count(*) FROM public.municipalities
--   WHERE parent_city_code IS NOT NULL GROUP BY parent_city_code ORDER BY parent_city_code;
--   -- 期待: 01100=10,04100=5,11100=10,12100=6,14100=18,14130=7,14150=3,15100=8,
--   --       22100=3,22130=7,23100=16,26100=11,27100=24,27140=7,28100=9,33100=4,
--   --       34100=8,40100=7,40130=7,43100=5  （合計175）
--
-- (V3) 東京特別区 = 23行（parent_city_code は NULL のまま）:
--   SELECT count(*) FROM public.municipalities
--   WHERE prefecture_code='13' AND city_code BETWEEN '13101' AND '13123';  -- 期待 23
--   SELECT count(*) FROM public.municipalities
--   WHERE prefecture_code='13' AND city_code BETWEEN '13101' AND '13123'
--     AND parent_city_code IS NOT NULL;  -- 期待 0
--
-- (V4) 親解決失敗 = 0行:
--   SELECT count(*) FROM public.municipalities w
--   WHERE w.parent_city_code IS NOT NULL AND NOT EXISTS (
--     SELECT 1 FROM public.municipalities p
--     WHERE p.city_code=w.parent_city_code AND p.is_designated_city);  -- 期待 0
--
-- ロールバック（逆SQL）:
--   ALTER TABLE public.municipalities DROP COLUMN IF EXISTS parent_city_code;
--   ALTER TABLE public.municipalities DROP COLUMN IF EXISTS is_designated_city;
--   DROP INDEX IF EXISTS public.idx_municipalities_parent_city_code;
--   DROP INDEX IF EXISTS public.idx_municipalities_pref_designated;
-- =====================================================================

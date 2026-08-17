-- =====================================================================
-- 20260817000000_m2_5b_geocode_match.sql
-- M2-5b PR#2 / CL-29: 住所 → 代表点（geo_reference_points）突合。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う（R7・D57）。
--   ※ supabase db push は恒久禁止。
--
-- 本 migration が作るもの:
--   (1) 文字レベル正規化の SQL 実装 public.normalize_address_jp(text)
--       ── src/lib/customer-list/normalize.ts の normalizeAddress と「同一規則」。
--   (2) 位置参照情報（ISJ）側の派生キー関数（丁目の分解・町字＋小字の連結キー）
--   (3) 上記に対する式インデックス 2 本（geo_reference_points）
--   (4) 突合関数 public.match_address_to_geo_point(...)
--   (5) 突合結果テーブル public.customer_list_row_geocodes（customer_list_rows と 1:1）
--
-- 前提（2026-08-17 に本番 DB で実測確認済み・推測ではない）:
--   - PostgreSQL 17.6 / PostGIS 有効（extensions スキーマ）。
--   - public.geo_reference_points は適用済み・データ投入済み。
--       total 383,653 行（block 380,600 / town 3,053）・対象8市
--       （23201 豊橋 / 23202 岡崎 / 23210 刈谷 / 23211 豊田 / 23212 安城 /
--         23225 知立 / 23227 高浜 / 46201 鹿児島）。
--   - town_raw に丁目を含む行 73,495 件は「すべて漢数字丁目」（算用数字は 0 件）。
--     出現する丁目は 一〜九・十・十一〜十七（百/千は出現しない）。
--   - block_raw が非数値の行 = 235 件（例: '甲151' '乙' '19第1' '123内'）。
--   - subarea_raw（小字）を持つ行 = 239,554 件。
--   - ISJ 生フィールドは 空白 0 件 / NFKC 差分 0 件 / 「字」「大字」0 件 /
--     ハイフン類 0 件。ただし **長音「ー」35 件（豊田市 幸海町「ゴード」等）** と
--     **旧字体 1,264 件（town_raw 549 + subarea_raw 715）** は実在する。
--
-- ⚠ 最重要の設計制約 ── 突合の対称性（PR#1 のコメントに明記済み）:
--   突合は「両側に同じ規則を適用して初めて一致する」。本 migration の
--   normalize_address_jp は、normalize.ts の normalizeAddress と
--   ① NFKC ② 旧字体→新字体 ③ ハイフン類＋長音「ー」→ '-' ④ 大字/字 除去
--   ⑤ 空白除去 ⑥ 連続ハイフン圧縮 ⑦ trim を **同じ順序・同じ文字集合** で行う。
--   片側だけ適用すると静かに不一致になる（長音が最も見落としやすい）。
--   → 検証節に、TS 側の出力と 1 文字違わないことを確認する SELECT を置いた。
--
-- ⚠ 前提の是正（タスク指示との差異・PM 確認事項）:
--   タスク指示は「RLS は auth.uid() = user_id を担保」だが、本番 DB は
--   20260814100200_step1_switch_customer_rls_to_org が **適用済み** で、
--   customer_lists / customer_list_rows の RLS は既に org 方針
--   （SELECT = 同一 org 共有 / INSERT・UPDATE・DELETE = 作成者本人 AND org 一致）に
--   移行している（pg_policies 実測 8 本・organization_id は両表とも NOT NULL）。
--   ここで user_id 単独の RLS を書くと「行は見えるが座標だけ見えない」破綻が起きるため、
--   本テーブルは customer_list_rows の現行ポリシーと **同型** にした（D25 の
--   ID 単位分離は STEP1 で org 単位分離へ発展済み、という理解）。
-- =====================================================================

BEGIN;

-- 式インデックス 2 本を 383,653 行に対して構築する。既定の statement_timeout では
-- 足りない可能性があるため、このトランザクションに限り緩める。
SET LOCAL statement_timeout = '15min';


-- =====================================================================
-- (1) 文字レベル正規化 ── normalize.ts の normalizeAddress と同一規則
-- =====================================================================
-- 標準 SQL 本体（RETURN 式）で定義する。この形式は **作成時に解析されて依存先が
-- OID で固定される**ため、実行時 search_path の影響を受けない（SET 句を付けずに
-- search_path 安全）。同時に IMMUTABLE を保てるので式インデックスに使える。
CREATE OR REPLACE FUNCTION public.normalize_address_jp(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURN btrim(
  -- ⑥ 連続ハイフンの圧縮（"1--2" → "1-2"）
  regexp_replace(
    -- ⑤ 空白の除去（半角/全角/タブ）
    regexp_replace(
      -- ④-b 「字」除去。直前が [0-9-] のときは残す
      --      （TS の (?<![0-9-])字 と同一。PG 9.5+ の後読み制約で同じ意味になる）
      regexp_replace(
        -- ④-a 「大字」除去
        replace(
          -- ③ ハイフン・ダッシュ・**長音「ー」**類 → 半角 '-'
          --    TS の HYPHEN_VARIANTS と同一の文字集合。
          regexp_replace(
            -- ② 旧字体 → 新字体（TS の KYUJITAI_MAP と同一の 25 組・同一順序）
            translate(
              -- ① Unicode NFKC（全角英数→半角・全角数字→算用数字・互換文字）
              normalize(coalesce(input, ''), NFKC),
              '澤齋齊邊邉龍髙﨑嵜圓檜濱濵舘廣惠槇國區會應櫻萬峯茨',
              '沢斎斎辺辺竜高崎崎円桧浜浜館広恵槙国区会応桜万峰茨'),
            '[‐‑‒–—―ー−﹣－ｰ]', '-', 'g'),
          '大字', ''),
        '(?<![0-9-])字', '', 'g'),
      '[\s　]+', '', 'g'),
    '-{2,}', '-', 'g')
);

COMMENT ON FUNCTION public.normalize_address_jp(text) IS
  'M2-5b/CL-29: src/lib/customer-list/normalize.ts の normalizeAddress と同一規則の SQL 実装。'
  'NFKC→旧字体→ハイフン/長音「ー」→''-''→大字/字除去→空白除去→連続ハイフン圧縮→trim。'
  '突合は両側に同じ規則を適用して初めて一致するため、TS 側を変更したら必ず本関数も同時に変更すること。';


-- =====================================================================
-- (1-b) 漢数字 → 算用数字 ── normalize-jp.ts の parseJpNumber と同一規則
-- =====================================================================
-- ISJ の丁目は 100% 漢数字（実測 73,495 行）。TS 側は算用数字の文字列を返す契約
-- なので、SQL 側でも同じ規則で算用数字化しないと丁目が一致しない。
CREATE OR REPLACE FUNCTION public.jp_number_to_arabic(value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_ch        text;
  v_digit     int;
  v_unit      int;
  v_total     bigint := 0;
  v_pending   int := NULL;
  v_last_unit int := 10000;
  v_num       bigint;
  v_buf       text := '';
  i           int;
BEGIN
  IF value IS NULL OR value = '' THEN
    RETURN NULL;
  END IF;
  -- 18 桁超は bigint 溢れ（＝式インデックス構築を落とす例外）になりうるので
  -- 「解釈できない」= NULL とする。住所の丁目/番地には存在しない桁数。
  IF length(value) > 18 THEN
    RETURN NULL;
  END IF;

  IF value ~ '^[0-9]+$' THEN
    v_num := value::bigint;

  ELSIF value ~ '^[〇零一二三四五六七八九壱弐参]+$' THEN
    -- 位取りなしの並び（「一二三」= 123）。桁を連結して読む（TS と同一）。
    FOR i IN 1..length(value) LOOP
      v_ch := substr(value, i, 1);
      v_digit := CASE v_ch
                   WHEN '〇' THEN 0 WHEN '零' THEN 0
                   WHEN '一' THEN 1 WHEN '壱' THEN 1
                   WHEN '二' THEN 2 WHEN '弐' THEN 2
                   WHEN '三' THEN 3 WHEN '参' THEN 3
                   WHEN '四' THEN 4 WHEN '五' THEN 5 WHEN '六' THEN 6
                   WHEN '七' THEN 7 WHEN '八' THEN 8 WHEN '九' THEN 9
                 END;
      v_buf := v_buf || v_digit::text;
    END LOOP;
    v_num := v_buf::bigint;

  ELSE
    -- 位取りあり（「十一」= 11 / 「二十」= 20）。TS の loop と同一の判定。
    FOR i IN 1..length(value) LOOP
      v_ch := substr(value, i, 1);
      v_digit := CASE v_ch
                   WHEN '〇' THEN 0 WHEN '零' THEN 0
                   WHEN '一' THEN 1 WHEN '壱' THEN 1
                   WHEN '二' THEN 2 WHEN '弐' THEN 2
                   WHEN '三' THEN 3 WHEN '参' THEN 3
                   WHEN '四' THEN 4 WHEN '五' THEN 5 WHEN '六' THEN 6
                   WHEN '七' THEN 7 WHEN '八' THEN 8 WHEN '九' THEN 9
                 END;
      IF v_digit IS NOT NULL THEN
        IF v_pending IS NOT NULL THEN
          RETURN NULL;   -- 「一二十」のような並びは解釈しない（推測しない）
        END IF;
        v_pending := v_digit;
        CONTINUE;
      END IF;

      v_unit := CASE v_ch WHEN '十' THEN 10 WHEN '百' THEN 100 WHEN '千' THEN 1000 END;
      IF v_unit IS NULL OR v_unit >= v_last_unit THEN
        RETURN NULL;
      END IF;
      v_total := v_total + coalesce(v_pending, 1) * v_unit;
      v_pending := NULL;
      v_last_unit := v_unit;
    END LOOP;
    v_num := v_total + coalesce(v_pending, 0);
  END IF;

  IF v_num IS NULL OR v_num <= 0 THEN
    RETURN NULL;   -- 0丁目・負値は住所として認めない（TS と同一）
  END IF;
  RETURN v_num::text;
END;
$$;

COMMENT ON FUNCTION public.jp_number_to_arabic(text) IS
  'M2-5b/CL-29: src/lib/address/normalize-jp.ts の parseJpNumber と同一規則。'
  '解釈できない表記は例外を投げず NULL（＝推測で補完しない・原則1）。18桁超も NULL。';


-- =====================================================================
-- (2) 位置参照情報（ISJ）側の派生キー
-- =====================================================================
-- ISJ の town_raw は丁目を含む生値（'平川本町一丁目'）。TS 側の契約は
-- 「town = 丁目を除いた町字名 / chome = 算用数字の文字列」なので、
-- SQL 側でも同じ形へ分解してから突き合わせる。

-- 末尾の「<漢数字>丁目」を取り除いた生の町字名（正規化前）。
CREATE OR REPLACE FUNCTION public.geo_town_base_raw(town_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURN regexp_replace(coalesce(town_raw, ''), '[〇零一二三四五六七八九十百千壱弐参]+丁目$', '');

-- 丁目（算用数字の文字列）。丁目が無ければ NULL。
CREATE OR REPLACE FUNCTION public.geo_town_chome(town_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURN public.jp_number_to_arabic(
  (regexp_match(coalesce(town_raw, ''), '([〇零一二三四五六七八九十百千壱弐参]+)丁目$'))[1]
);

-- 突合キー（小字なし）: 町字名のみ。住所側が小字を書いていない場合に使う。
CREATE OR REPLACE FUNCTION public.geo_town_base_key(town_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURN public.normalize_address_jp(public.geo_town_base_raw(town_raw));

-- 突合キー（小字連結）: 町字名＋小字。
--   PR#1 の契約どおり TS 側は town と小字を分離できない（住所文字列だけでは
--   境界を確定できないため・原則1）。よって TS の town には「町字名＋小字」が
--   連結されたまま入りうる。分離はせず、**ISJ 側を同じ形に連結して**突き合わせる。
--   例: 住所 '豊田市幸海町ゴード10' → TS town='幸海町ゴ-ド'
--       ISJ town_raw='幸海町' + subarea_raw='ゴード' → キー '幸海町ゴ-ド'（一致）
CREATE OR REPLACE FUNCTION public.geo_town_key(town_raw text, subarea_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURN public.normalize_address_jp(
  public.geo_town_base_raw(town_raw) || coalesce(subarea_raw, '')
);

COMMENT ON FUNCTION public.geo_town_base_raw(text) IS
  'M2-5b: ISJ town_raw から末尾の「<漢数字>丁目」を除いた生の町字名。';
COMMENT ON FUNCTION public.geo_town_chome(text) IS
  'M2-5b: ISJ town_raw の丁目を算用数字の文字列で返す（TS 契約と同一表現）。無ければ NULL。';
COMMENT ON FUNCTION public.geo_town_base_key(text) IS
  'M2-5b: 突合キー（小字なし）。normalize_address_jp を通すので TS 側 town と同一規則。';
COMMENT ON FUNCTION public.geo_town_key(text, text) IS
  'M2-5b: 突合キー（町字名＋小字を連結）。TS 側 town に小字が連結されたまま来る契約に合わせる。';

-- 関数の実行権限（新規 public 関数は既定で PUBLIC に EXECUTE が付くため明示的に剥奪）。
REVOKE ALL ON FUNCTION public.normalize_address_jp(text)   FROM public, anon;
REVOKE ALL ON FUNCTION public.jp_number_to_arabic(text)    FROM public, anon;
REVOKE ALL ON FUNCTION public.geo_town_base_raw(text)      FROM public, anon;
REVOKE ALL ON FUNCTION public.geo_town_chome(text)         FROM public, anon;
REVOKE ALL ON FUNCTION public.geo_town_base_key(text)      FROM public, anon;
REVOKE ALL ON FUNCTION public.geo_town_key(text, text)     FROM public, anon;

GRANT EXECUTE ON FUNCTION public.normalize_address_jp(text)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.jp_number_to_arabic(text)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.geo_town_base_raw(text)      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.geo_town_chome(text)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.geo_town_base_key(text)      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.geo_town_key(text, text)     TO authenticated, service_role;


-- =====================================================================
-- (3) 式インデックス（突合の主経路）
-- =====================================================================
-- ⚠ 構築コスト: 383,653 行 × 関数 2 本。数十秒かかる想定（statement_timeout を
--   上で緩めてある）。以後 geo_reference_points への一括 INSERT は少し遅くなる
--   （ローダーは service_role のバッチなので実用上の問題はない）。
CREATE INDEX IF NOT EXISTS geo_reference_points_match_base_idx
  ON public.geo_reference_points (
    muni_code_5,
    level,
    public.geo_town_base_key(town_raw),
    public.geo_town_chome(town_raw)
  );

CREATE INDEX IF NOT EXISTS geo_reference_points_match_full_idx
  ON public.geo_reference_points (
    muni_code_5,
    level,
    public.geo_town_key(town_raw, subarea_raw),
    public.geo_town_chome(town_raw)
  );


-- =====================================================================
-- (4) 突合関数
-- =====================================================================
-- 入力は normalize-jp.ts の normalizeJpAddress が返す (muniCode5, town, chome, ban, go)。
-- 常に 1 行だけ返す（見つからない場合も match_method='unmatched' の 1 行を返す）。
--
-- 突合の階段（上から順に評価し、最初に「一意に」当たったところで確定する）:
--   A. block_exact            … 街区レベル・町字＋小字＋丁目＋街区符号が完全一致   → confirmed
--   B. block_exact_no_subarea … 住所に小字が無く、町字＋丁目＋街区符号で街区が一意 → confirmed
--   C. block_number_prefix    … block_raw が非数値（'甲151' '19第1' 等 235 件）で、
--                               先頭数値列が番地に一致し、かつ候補が一意        → inferred
--   D. town_exact             … 大字・町丁目レベルの代表点が一致                  → 番地なし confirmed / 番地あり inferred
--   E. subarea_centroid       … 小字までは一致するが街区符号が当たらない
--                               → その小字の街区代表点の重心                      → inferred
--   F. town_centroid          … 町丁目レベルの点が無い町字
--                               → その町字の街区代表点の重心                      → inferred
--   G. unmatched              … 上のいずれにも当たらない                           → unknown
--
-- 原則1（確定と推定を混ぜない）: match_method で経路を、match_confidence で
--   confirmed / inferred / unknown を分けて返す。match_confidence を数値スコアに
--   しないのは、較正された確率が無いのに数値を出すと「推定に根拠のない精度」を
--   与えてしまうため（3 値＋ match_reason で根拠を文字で残す）。
--
-- ⚠ SECURITY INVOKER であることの帰結（意図的な設計・SD-32 を緩めない）:
--   geo_reference_points は deny-by-default（anon/authenticated に GRANT もポリシーも
--   無い）。したがって authenticated セッションから本関数を呼ぶと **常に 0 件側
--   （unmatched）** になる。突合は import 時のサーバー側処理（Route Handler / ETL の
--   service_role）で回す設計であり、そのために参照テーブルの RLS を緩めることはしない。
--   EXECUTE は指示どおり anon に付けず authenticated と service_role にのみ付与する。
CREATE OR REPLACE FUNCTION public.match_address_to_geo_point(
  p_muni_code_5 text,
  p_town        text,
  p_chome       text DEFAULT NULL,
  p_ban         text DEFAULT NULL,
  p_go          text DEFAULT NULL
)
RETURNS TABLE (
  geo_point_id     uuid,
  lat              double precision,
  lon              double precision,
  matched_town     text,
  matched_subarea  text,
  matched_chome    text,
  matched_block    text,
  match_method     text,
  match_confidence text,
  match_reason     text,
  candidate_count  integer,
  source_version   text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_town   text := public.normalize_address_jp(p_town);
  v_chome  text := nullif(btrim(coalesce(p_chome, '')), '');
  v_ban    text := nullif(btrim(coalesce(p_ban, '')), '');
  v_n      integer;
  v_reason text;
BEGIN
  -- p_go（号）は突合に使わない。位置参照情報は号レベルの点を持たない（最小粒度は街区）。
  -- 引数として受けるのは TS 側の契約 (muniCode5, town, chome, ban, go) をそのまま
  -- 渡せるようにするためで、将来 号レベルのデータが入ったときの拡張点でもある。

  IF p_muni_code_5 IS NULL OR v_town = '' THEN
    RETURN QUERY
      SELECT NULL::uuid, NULL::double precision, NULL::double precision,
             NULL::text, NULL::text, NULL::text, NULL::text,
             'unmatched'::text, 'unknown'::text,
             '自治体コードまたは町字名が空のため突合しない'::text,
             0, NULL::text;
    RETURN;
  END IF;

  -- ── A. 街区レベル完全一致（町字＋小字＋丁目＋街区符号）────────────────
  RETURN QUERY
  WITH cand AS (
    SELECT g.id, g.lat, g.lon, g.town_raw, g.subarea_raw, g.block_raw, g.source_version
    FROM public.geo_reference_points g
    WHERE g.level = 'block'
      AND g.muni_code_5 = p_muni_code_5
      AND public.geo_town_key(g.town_raw, g.subarea_raw) = v_town
      AND public.geo_town_chome(g.town_raw) IS NOT DISTINCT FROM v_chome
      AND g.block_raw = v_ban
  ),
  agg AS (
    -- 同一の自然キーが版違い（source_version）で並存しうるので、行数ではなく
    -- 「異なる位置キーの数」で一意性を判定する。
    SELECT count(DISTINCT (c.town_raw, c.subarea_raw, c.block_raw))::int AS n FROM cand c
  )
  SELECT DISTINCT ON (c.town_raw, c.subarea_raw, c.block_raw)
         c.id, c.lat, c.lon,
         c.town_raw, c.subarea_raw, public.geo_town_chome(c.town_raw), c.block_raw,
         'block_exact'::text, 'confirmed'::text,
         format('街区レベル完全一致: %s%s %s番（町字・小字・丁目・街区符号のすべてが一致）',
                c.town_raw, c.subarea_raw, c.block_raw),
         a.n, c.source_version
  FROM cand c CROSS JOIN agg a
  WHERE a.n = 1
  ORDER BY c.town_raw, c.subarea_raw, c.block_raw, c.source_version DESC;
  IF FOUND THEN RETURN; END IF;

  -- ── B. 街区レベル一致（住所に小字が無い。町字＋丁目＋街区符号で街区が一意）──
  RETURN QUERY
  WITH cand AS (
    SELECT g.id, g.lat, g.lon, g.town_raw, g.subarea_raw, g.block_raw, g.source_version
    FROM public.geo_reference_points g
    WHERE g.level = 'block'
      AND g.muni_code_5 = p_muni_code_5
      AND public.geo_town_base_key(g.town_raw) = v_town
      AND public.geo_town_chome(g.town_raw) IS NOT DISTINCT FROM v_chome
      AND g.block_raw = v_ban
  ),
  agg AS (
    SELECT count(DISTINCT (c.town_raw, c.subarea_raw, c.block_raw))::int AS n FROM cand c
  )
  SELECT DISTINCT ON (c.town_raw, c.subarea_raw, c.block_raw)
         c.id, c.lat, c.lon,
         c.town_raw, c.subarea_raw, public.geo_town_chome(c.town_raw), c.block_raw,
         'block_exact_no_subarea'::text, 'confirmed'::text,
         format('街区レベル一致（住所に小字の記載なし）: %s%s %s番。'
                '当該町字・丁目の中で街区符号 %s は一意',
                c.town_raw, c.subarea_raw, c.block_raw, c.block_raw),
         a.n, c.source_version
  FROM cand c CROSS JOIN agg a
  WHERE a.n = 1
  ORDER BY c.town_raw, c.subarea_raw, c.block_raw, c.source_version DESC;
  IF FOUND THEN RETURN; END IF;

  -- ── C. 非数値の街区符号（'甲151' '19第1' '123内' '乙' 等・実測 235 件）──────
  -- ISJ の block_raw には数値以外が混じる。TS 側の ban は必ず算用数字なので、
  -- 素の等値では絶対に当たらない。ここでは「先頭の数値列が番地に一致し、かつ
  -- 候補が一意」のときだけ拾い、甲/乙/第N の別は判断していないので inferred とする。
  -- （'乙' のように数値を含まない符号は最後まで当たらない＝拾わない。推測しない。）
  RETURN QUERY
  WITH cand AS (
    SELECT g.id, g.lat, g.lon, g.town_raw, g.subarea_raw, g.block_raw, g.source_version
    FROM public.geo_reference_points g
    WHERE g.level = 'block'
      AND g.muni_code_5 = p_muni_code_5
      AND (public.geo_town_key(g.town_raw, g.subarea_raw) = v_town
           OR public.geo_town_base_key(g.town_raw) = v_town)
      AND public.geo_town_chome(g.town_raw) IS NOT DISTINCT FROM v_chome
      AND v_ban IS NOT NULL
      AND g.block_raw !~ '^[0-9]+$'
      AND (regexp_match(g.block_raw, '[0-9]+'))[1] = v_ban
  ),
  agg AS (
    SELECT count(DISTINCT (c.town_raw, c.subarea_raw, c.block_raw))::int AS n FROM cand c
  )
  SELECT DISTINCT ON (c.town_raw, c.subarea_raw, c.block_raw)
         c.id, c.lat, c.lon,
         c.town_raw, c.subarea_raw, public.geo_town_chome(c.town_raw), c.block_raw,
         'block_number_prefix'::text, 'inferred'::text,
         format('街区符号が非数値（%s）。先頭の数値列が番地 %s に一致し候補が一意のため採用。'
                '甲/乙/第N の別までは確認していない（推定）',
                c.block_raw, v_ban),
         a.n, c.source_version
  FROM cand c CROSS JOIN agg a
  WHERE a.n = 1
  ORDER BY c.town_raw, c.subarea_raw, c.block_raw, c.source_version DESC;
  IF FOUND THEN RETURN; END IF;

  -- ── D. 大字・町丁目レベルの代表点（town フォールバック）────────────────
  -- 番地が指定されていなければ、町丁目代表点は要求された粒度そのもの＝confirmed。
  -- 番地が指定されているのにここまで落ちてきた場合は、住所より粗い粒度なので inferred。
  RETURN QUERY
  WITH cand AS (
    SELECT g.id, g.lat, g.lon, g.town_raw, g.subarea_raw, g.source_version
    FROM public.geo_reference_points g
    WHERE g.level = 'town'
      AND g.muni_code_5 = p_muni_code_5
      AND public.geo_town_base_key(g.town_raw) = v_town
      AND public.geo_town_chome(g.town_raw) IS NOT DISTINCT FROM v_chome
  ),
  agg AS (
    SELECT count(DISTINCT c.town_raw)::int AS n FROM cand c
  )
  SELECT DISTINCT ON (c.town_raw)
         c.id, c.lat, c.lon,
         c.town_raw, NULL::text, public.geo_town_chome(c.town_raw), NULL::text,
         'town_exact'::text,
         CASE WHEN v_ban IS NULL THEN 'confirmed' ELSE 'inferred' END::text,
         CASE WHEN v_ban IS NULL
              THEN format('大字・町丁目レベルの代表点に一致: %s', c.town_raw)
              ELSE format('大字・町丁目レベルの代表点に一致: %s。'
                          '番地 %s に対応する街区代表点は無いため町丁目の代表点で代替（推定）',
                          c.town_raw, v_ban)
         END,
         a.n, c.source_version
  FROM cand c CROSS JOIN agg a
  WHERE a.n = 1
  ORDER BY c.town_raw, c.source_version DESC;
  IF FOUND THEN RETURN; END IF;

  -- ── E. 小字までは一致するが街区符号が当たらない → 小字内の街区代表点の重心 ──
  -- 経緯度の単純平均（測地的重心ではない）。あくまで代表点の代替なので inferred。
  RETURN QUERY
  WITH cand AS (
    SELECT g.lat, g.lon, g.town_raw, g.subarea_raw, g.source_version
    FROM public.geo_reference_points g
    WHERE g.level = 'block'
      AND g.muni_code_5 = p_muni_code_5
      AND public.geo_town_key(g.town_raw, g.subarea_raw) = v_town
      AND public.geo_town_chome(g.town_raw) IS NOT DISTINCT FROM v_chome
  )
  SELECT NULL::uuid, avg(c.lat)::double precision, avg(c.lon)::double precision,
         min(c.town_raw), min(c.subarea_raw), v_chome, NULL::text,
         'subarea_centroid'::text, 'inferred'::text,
         format('街区符号が一致しないため、%s%s の街区代表点 %s 件の重心を用いた（推定）',
                min(c.town_raw), min(c.subarea_raw), count(*)),
         count(*)::int, max(c.source_version)
  FROM cand c
  HAVING count(*) > 0
     AND count(DISTINCT (c.town_raw, c.subarea_raw)) = 1;
  IF FOUND THEN RETURN; END IF;

  -- ── F. 町丁目レベルの点が無い町字 → その町字の街区代表点の重心 ─────────
  RETURN QUERY
  WITH cand AS (
    SELECT g.lat, g.lon, g.town_raw, g.source_version
    FROM public.geo_reference_points g
    WHERE g.level = 'block'
      AND g.muni_code_5 = p_muni_code_5
      AND public.geo_town_base_key(g.town_raw) = v_town
      AND public.geo_town_chome(g.town_raw) IS NOT DISTINCT FROM v_chome
  )
  SELECT NULL::uuid, avg(c.lat)::double precision, avg(c.lon)::double precision,
         min(c.town_raw), NULL::text, v_chome, NULL::text,
         'town_centroid'::text, 'inferred'::text,
         format('町丁目レベルの代表点が無いため、%s の街区代表点 %s 件の重心を用いた（推定）',
                min(c.town_raw), count(*)),
         count(*)::int, max(c.source_version)
  FROM cand c
  HAVING count(*) > 0
     AND count(DISTINCT c.town_raw) = 1;
  IF FOUND THEN RETURN; END IF;

  -- ── G. 不一致。なぜ当たらなかったかを reason に残す（断定しない・原則5）──────
  SELECT count(*)::int INTO v_n
  FROM public.geo_reference_points g
  WHERE g.muni_code_5 = p_muni_code_5
    AND (public.geo_town_base_key(g.town_raw) = v_town
         OR public.geo_town_key(g.town_raw, g.subarea_raw) = v_town);

  IF v_n = 0 THEN
    v_reason := format('位置参照情報に該当する町字名がありません（%s / %s）',
                       p_muni_code_5, v_town);
  ELSE
    v_reason := format('町字名は %s 件一致しましたが、丁目=%s・番地=%s まで'
                       '一意に一致する代表点がありません',
                       v_n, coalesce(v_chome, '未指定'), coalesce(v_ban, '未指定'));
  END IF;

  RETURN QUERY
    SELECT NULL::uuid, NULL::double precision, NULL::double precision,
           NULL::text, NULL::text, NULL::text, NULL::text,
           'unmatched'::text, 'unknown'::text, v_reason, v_n, NULL::text;
END;
$$;

COMMENT ON FUNCTION public.match_address_to_geo_point(text, text, text, text, text) IS
  'M2-5b/CL-29: 正規化済み住所 (muni_code_5, town, chome, ban, go) を '
  'geo_reference_points の代表点に突合する。常に 1 行返す。'
  'match_method で経路を、match_confidence(confirmed/inferred/unknown) で確定と推定を分ける（原則1）。'
  'SECURITY INVOKER のため authenticated からは参照テーブルの RLS により当たらない。'
  '突合は service_role のサーバー側処理で回す（SD-32 の deny-by-default は緩めない）。';

REVOKE ALL ON FUNCTION public.match_address_to_geo_point(text, text, text, text, text)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.match_address_to_geo_point(text, text, text, text, text)
  TO authenticated, service_role;


-- =====================================================================
-- (5) 突合結果テーブル（customer_list_rows と 1:1）
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.customer_list_row_geocodes (
  -- 1:1。row_id をそのまま主キーにして「1 行につき最新の突合結果 1 件」を構造で保証する。
  row_id             UUID PRIMARY KEY
                       REFERENCES public.customer_list_rows(id) ON DELETE CASCADE,

  -- RLS を join に依存させないための非正規化（customer_list_rows と同じ多層防御の流儀）。
  -- 値は BEFORE INSERT/UPDATE トリガーが親行から必ず上書きするため、ドリフトしない。
  list_id            UUID NOT NULL REFERENCES public.customer_lists(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id    UUID NOT NULL REFERENCES public.organizations(id),

  -- ── 突合に使った / 当たった住所要素 ────────────────────────────────
  muni_code_5        TEXT,        -- 5桁（municipalities.city_code と整合。6桁 muni_code とは別体系）
  matched_town       TEXT,        -- 当たった ISJ town_raw（丁目を含む生値）
  matched_subarea    TEXT,        -- 当たった ISJ subarea_raw（小字）。無ければ NULL
  matched_chome      TEXT,        -- 丁目（算用数字の文字列）
  matched_block      TEXT,        -- 当たった ISJ block_raw（街区符号・生値）

  -- ── 代表点 ─────────────────────────────────────────────────────
  -- 重心フォールバック（*_centroid）では単一の点に対応しないため geo_point_id は NULL。
  geo_point_id       UUID REFERENCES public.geo_reference_points(id) ON DELETE SET NULL,
  geo_source_version TEXT,        -- 由来した ISJ ファイル版（プロベナンス）
  lat                DOUBLE PRECISION,
  lon                DOUBLE PRECISION,
  -- GENERATED STORED。PostGIS 関数は非修飾（geo_reference_points と同じ search_path 依存の流儀）。
  geom               geometry(Point, 4326)
                       GENERATED ALWAYS AS (
                         CASE WHEN lat IS NOT NULL AND lon IS NOT NULL
                              THEN ST_SetSRID(ST_MakePoint(lon, lat), 4326)
                         END
                       ) STORED,

  -- ── 突合の根拠（原則1: 確定と推定を混ぜない・後段 UI が根拠を出せるように）────
  match_method       TEXT NOT NULL
                       CHECK (match_method IN (
                         'block_exact',             -- 街区完全一致（町字＋小字＋丁目＋街区符号）
                         'block_exact_no_subarea',  -- 街区一致（住所に小字なし・街区が一意）
                         'block_number_prefix',     -- 非数値街区符号の先頭数値一致（推定）
                         'town_exact',              -- 大字・町丁目レベル代表点
                         'subarea_centroid',        -- 小字内の街区代表点の重心（推定）
                         'town_centroid',           -- 町字の街区代表点の重心（推定）
                         'unmatched'                -- 不一致
                       )),
  match_confidence   TEXT NOT NULL
                       CHECK (match_confidence IN ('confirmed', 'inferred', 'unknown')),
  match_reason       TEXT,        -- 計算根拠の文字列（画面の「推定」バッジの説明に使う）
  candidate_count    INTEGER NOT NULL DEFAULT 0,

  matched_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 不一致なら座標を持たない／一致なら必ず持つ。緯度と経度は同時に有無が決まる。
  CONSTRAINT customer_list_row_geocodes_point_consistency
    CHECK ((lat IS NULL) = (lon IS NULL)
           AND (match_confidence = 'unknown') = (lat IS NULL)),
  -- unmatched と unknown は必ず同時に立つ（片方だけの中途半端な行を作らせない）。
  CONSTRAINT customer_list_row_geocodes_unmatched_consistency
    CHECK ((match_method = 'unmatched') = (match_confidence = 'unknown'))
);

COMMENT ON TABLE public.customer_list_row_geocodes IS
  'M2-5b/CL-29: customer_list_rows の各行に対する住所→代表点の突合結果（1:1・row_id が主キー）。'
  'match_method で経路を、match_confidence(confirmed/inferred/unknown) で確定と推定を分ける（原則1）。'
  'RLS は customer_list_rows と同型（SELECT=同一 org 共有 / 書込=作成者本人 AND org 一致）。';
COMMENT ON COLUMN public.customer_list_row_geocodes.muni_code_5 IS
  '5桁の全国地方公共団体コード（municipalities.city_code と整合）。'
  'town_monthly_metrics.muni_code（6桁）とは別体系。桁合わせでの直接比較はしない。';
COMMENT ON COLUMN public.customer_list_row_geocodes.geo_point_id IS
  '当たった geo_reference_points の行。重心フォールバック（*_centroid）では単一点に'
  '対応しないため NULL。NULL であること自体が「点そのものではない」根拠になる。';
COMMENT ON COLUMN public.customer_list_row_geocodes.match_method IS
  'block_exact / block_exact_no_subarea / block_number_prefix / town_exact / '
  'subarea_centroid / town_centroid / unmatched。match_address_to_geo_point の返り値と 1:1。';
COMMENT ON COLUMN public.customer_list_row_geocodes.match_confidence IS
  'confirmed=住所の粒度と同等以上の粒度で厳密一致 / inferred=より粗い粒度または非厳密規則 / '
  'unknown=不一致。較正された確率が無いため数値スコアにはしない（原則1）。';
COMMENT ON COLUMN public.customer_list_row_geocodes.match_reason IS
  '計算根拠。推定（inferred）の行は画面で必ず「推定」バッジとともにこの文言を出す。';

CREATE INDEX IF NOT EXISTS customer_list_row_geocodes_list_idx
  ON public.customer_list_row_geocodes (list_id);
CREATE INDEX IF NOT EXISTS customer_list_row_geocodes_org_idx
  ON public.customer_list_row_geocodes (organization_id);
CREATE INDEX IF NOT EXISTS customer_list_row_geocodes_geom_gist
  ON public.customer_list_row_geocodes USING gist (geom);

-- ── 親行から所有情報を継承するトリガー（親子の org 不一致を構造的に防止）──────
-- 20260814100100 の set_customer_list_row_org と同型。INSERT/UPDATE の両方で
-- 必ず親行の値に揃えるため、クライアントが list_id / user_id / organization_id を
-- 詐称しても意味を持たない。詐称した row_id を渡した場合は、揃えた結果が
-- RLS の WITH CHECK（org 一致・作成者本人）に落ちて拒否される。
CREATE OR REPLACE FUNCTION public.set_customer_list_row_geocode_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  SELECT r.list_id, r.user_id, r.organization_id
    INTO NEW.list_id, NEW.user_id, NEW.organization_id
  FROM public.customer_list_rows r
  WHERE r.id = NEW.row_id;

  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'customer_list_row_geocodes: 親行 % が存在しません', NEW.row_id;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_customer_list_row_geocode_owner() FROM public, anon;

COMMENT ON FUNCTION public.set_customer_list_row_geocode_owner() IS
  'M2-5b: customer_list_row_geocodes の list_id/user_id/organization_id を親 customer_list_rows から'
  '必ず上書きする（詐称不能・親子 org 一致を保証）。UPDATE では updated_at も更新する。';

DROP TRIGGER IF EXISTS trg_set_customer_list_row_geocode_owner
  ON public.customer_list_row_geocodes;
CREATE TRIGGER trg_set_customer_list_row_geocode_owner
  BEFORE INSERT OR UPDATE ON public.customer_list_row_geocodes
  FOR EACH ROW EXECUTE FUNCTION public.set_customer_list_row_geocode_owner();

-- ── RLS（customer_list_rows の現行ポリシーと同型・D25 の分離を維持）─────────
ALTER TABLE public.customer_list_row_geocodes ENABLE ROW LEVEL SECURITY;

-- 関数呼び出しは行ごと再評価を避けるため必ず (select ...) / IN (SELECT ...) で包む。
DROP POLICY IF EXISTS "clrg_select_org" ON public.customer_list_row_geocodes;
CREATE POLICY "clrg_select_org" ON public.customer_list_row_geocodes
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.current_user_org_ids()));

DROP POLICY IF EXISTS "clrg_insert_org" ON public.customer_list_row_geocodes;
CREATE POLICY "clrg_insert_org" ON public.customer_list_row_geocodes
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (SELECT public.current_user_org_ids())
    AND user_id = (select auth.uid())
  );

DROP POLICY IF EXISTS "clrg_update_org" ON public.customer_list_row_geocodes;
CREATE POLICY "clrg_update_org" ON public.customer_list_row_geocodes
  FOR UPDATE TO authenticated
  USING (
    user_id = (select auth.uid())
    AND organization_id IN (SELECT public.current_user_org_ids())
  )
  WITH CHECK (
    user_id = (select auth.uid())
    AND organization_id IN (SELECT public.current_user_org_ids())
  );

DROP POLICY IF EXISTS "clrg_delete_org" ON public.customer_list_row_geocodes;
CREATE POLICY "clrg_delete_org" ON public.customer_list_row_geocodes
  FOR DELETE TO authenticated
  USING (
    user_id = (select auth.uid())
    AND organization_id IN (SELECT public.current_user_org_ids())
  );

-- ── テーブル権限の最小化 ──────────────────────────────────────────
-- anon には一切付けない（顧客個人情報に紐づく派生データ）。
-- authenticated は SELECT のみ。突合結果は「取り込み時にサーバー側（service_role）が
-- 算出して書く導出データ」であり、クライアントが直接書き換えてよい値ではない。
-- INSERT/UPDATE/DELETE のポリシーは、将来 GRANT が変わっても行レベルで守られるよう
-- 多層防御として先に置いてある。
REVOKE ALL ON public.customer_list_row_geocodes FROM anon, authenticated;
GRANT SELECT ON public.customer_list_row_geocodes TO authenticated;

COMMIT;


-- =====================================================================
-- ロールバック SQL（適用を取り消す場合・PM が手動実行）:
--   BEGIN;
--   DROP TABLE IF EXISTS public.customer_list_row_geocodes;   -- ⚠ 突合結果も消える
--   DROP FUNCTION IF EXISTS public.set_customer_list_row_geocode_owner();
--   DROP FUNCTION IF EXISTS public.match_address_to_geo_point(text, text, text, text, text);
--   DROP INDEX IF EXISTS public.geo_reference_points_match_full_idx;
--   DROP INDEX IF EXISTS public.geo_reference_points_match_base_idx;
--   DROP FUNCTION IF EXISTS public.geo_town_key(text, text);
--   DROP FUNCTION IF EXISTS public.geo_town_base_key(text);
--   DROP FUNCTION IF EXISTS public.geo_town_chome(text);
--   DROP FUNCTION IF EXISTS public.geo_town_base_raw(text);
--   DROP FUNCTION IF EXISTS public.jp_number_to_arabic(text);
--   DROP FUNCTION IF EXISTS public.normalize_address_jp(text);
--   COMMIT;
-- =====================================================================


-- =====================================================================
-- 検証クエリ（適用後に手動実行）
-- =====================================================================
--
-- ── ① 正規化の対称性（TS と SQL が 1 文字も違わないこと）──────────────
--   下の期待値は src/lib/customer-list/normalize.ts の normalizeAddress を
--   node で実行した実出力（2026-08-17 実測）。全行 t になること。
--   ⚠ 4 行目が長音「ー」の回帰テスト。ここが f なら片側だけ正規化している。
--   ⚠ 下 3 行が旧字体（translate 25 組）の回帰テスト。位置参照情報に実在する
--     旧字体を選んである（実測: 峯 772 件 / 澤 111 件 / 舘 95 件）。
--
--   SELECT input, expected, public.normalize_address_jp(input) AS actual,
--          public.normalize_address_jp(input) = expected AS ok
--   FROM (VALUES
--     ('幸海町',                              '幸海町'),
--     ('大脇ノ谷',                            '大脇ノ谷'),
--     ('平川本町一丁目',                      '平川本町一丁目'),
--     ('ゴード',                              'ゴ-ド'),                       -- 長音
--     ('愛知県豊田市大字幸海町字ゴード１２ｰ３','愛知県豊田市幸海町ゴ-ド12-3'), -- 長音＋大字/字＋全角
--     ('1字2',                                '1字2'),                        -- 後読み（残す）
--     ('町字A',                               '町A'),                         -- 後読み（除去）
--     ('  藤　澤　町 ',                       '藤沢町'),                      -- 空白＋旧字体 澤→沢
--     ('丸山町経ケ峯',                        '丸山町経ケ峰'),                -- 旧字体 峯→峰（豊田市 丸山町「経ケ峯」実在・772件）
--     ('姫小川町舘出',                        '姫小川町館出')                 -- 旧字体 舘→館（安城市 姫小川町「舘出」実在・95件）
--   ) AS t(input, expected);
--
--   ⚠ translate の 25 組は TS 側 KYUJITAI_MAP と機械的に突き合わせて完全一致を
--     確認済み（2026-08-17・両ファイルから正規表現で抽出して文字列比較）。
--     末尾の '茨'→'茨' は **TS 原本がそのまま恒等写像** になっているためで、
--     SQL 側の写し間違いではない（TS を直さない限り SQL も直さない）。
--     なお '﨑'(U+FA11) は NFKC で分解されない互換漢字なので、translate が
--     実際に効いている（NFKC 任せにはできない）。
--
-- ── ② 漢数字→算用数字（ISJ に実在する丁目の全種）────────────────────
--   SELECT k, public.jp_number_to_arabic(k) FROM unnest(ARRAY[
--     '一','二','三','四','五','六','七','八','九','十','十一','十二','十三','十四','十五','十六','十七'
--   ]) AS k;
--   -- 期待: 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17
--
-- ── ③ ISJ 側の分解が全行成立していること（丁目付き 73,495 行が全部読めるか）──
--   SELECT count(*) AS chome_rows,
--          count(*) FILTER (WHERE public.geo_town_chome(town_raw) IS NULL) AS unparsed
--   FROM public.geo_reference_points WHERE town_raw ~ '丁目$';
--   -- 期待: chome_rows=73495 / unparsed=0
--
-- ── ④ 8市サンプルでの疎通確認（住所→代表点）──────────────────────
--   ⚠ service_role で実行すること。authenticated では geo_reference_points の
--     RLS（deny-by-default）により全件 unmatched になるのが正しい挙動。
--
--   SELECT s.label, m.match_method, m.match_confidence,
--          m.matched_town, m.matched_subarea, m.matched_chome, m.matched_block,
--          round(m.lat::numeric, 6) AS lat, round(m.lon::numeric, 6) AS lon,
--          m.candidate_count, m.match_reason
--   FROM (VALUES
--     ('豊橋・丁目＋街区',     '23201', '平川本町',         '1',  '16', NULL),
--     ('豊橋・小字＋街区',     '23201', '大岩町菅池',       NULL, '19', NULL),
--     ('岡崎・小字連結＋街区', '23202', '上三ツ木町八ツ田', NULL, '2',  NULL),
--     ('豊田・長音小字＋街区', '23211', '幸海町ゴ-ド',      NULL, '10', NULL),
--     ('岡崎・町丁目',         '23202', 'みはらし台',       '1',  NULL, NULL),
--     ('刈谷・町字のみ',       '23210', '一ツ木町',         NULL, NULL, NULL),
--     ('豊田・町字のみ',       '23211', 'トヨタ町',         NULL, NULL, NULL),
--     ('安城・丁目',           '23212', '三河安城南町',     '1',  NULL, NULL),
--     ('知立・町字のみ',       '23225', '上重原町',         NULL, NULL, NULL),
--     ('高浜・丁目',           '23227', '二池町',           '1',  NULL, NULL),
--     ('鹿児島・町字のみ',     '46201', '三和町',           NULL, NULL, NULL),
--     ('存在しない町字',       '23202', '存在しない町',     NULL, NULL, NULL)
--   ) AS s(label, muni, town, chome, ban, go)
--   CROSS JOIN LATERAL public.match_address_to_geo_point(s.muni, s.town, s.chome, s.ban, s.go) m;
--
--   -- 期待値（2026-08-17 に本番データへ同等クエリを流して確認した実測。8市すべてを網羅）:
--   --   平川本町 1-16     → block_exact  / confirmed / 平川本町一丁目          16   34.761119 137.424702
--   --   大岩町菅池 19     → block_exact  / confirmed / 大岩町 菅池             19   34.725647 137.432869
--   --   上三ツ木町八ツ田 2→ block_exact  / confirmed / 上三ツ木町 八ツ田        2   34.904840 137.132275
--   --   幸海町ゴ-ド 10    → block_exact  / confirmed / 幸海町 ゴード           10   35.085766 137.239440  ← 長音の回帰テスト
--   --   みはらし台 1丁目  → town_exact   / confirmed / みはらし台一丁目             34.920591 137.199620
--   --   一ツ木町          → town_exact   / confirmed / 一ツ木町                     35.016664 137.029172
--   --   トヨタ町          → town_exact   / confirmed / トヨタ町                     35.056275 137.161408
--   --   三河安城南町 1丁目→ town_exact   / confirmed / 三河安城南町一丁目           34.966167 137.060033
--   --   上重原町          → town_exact   / confirmed / 上重原町                     34.998483 137.022159
--   --   二池町 1丁目      → town_exact   / confirmed / 二池町一丁目                 34.918023 136.988928
--   --   三和町            → town_exact   / confirmed / 三和町                       31.550080 130.554298
--   --   存在しない町      → unmatched    / unknown   / candidate_count=0
--   --
--   -- ⚠ 「刈谷・一ツ木町」は town レベルに '一ツ木町' と '一ツ木町一丁目' の
--   --    両方が存在する町字。丁目を指定しない問い合わせが '一ツ木町'（丁目なしの行）
--   --    だけに当たること＝丁目の有無を混ぜていないことの確認になっている。
--   --
--   -- ── 丁目を指定しない場合に「推測しない」ことの確認 ────────────────
--   --   SELECT * FROM public.match_address_to_geo_point('23210', '相生町', NULL, NULL, NULL);
--   --   -- 刈谷市 相生町は一丁目〜三丁目に分かれ、丁目なしの代表点を持たない。
--   --   -- 期待: unmatched / unknown（どれか 1 つの丁目に寄せる推測はしない・原則1）。
--
-- ── ⑤ 非数値街区符号 235 件が「素の等値では当たらない」ことの確認 ────────
--   SELECT count(*) FROM public.geo_reference_points
--   WHERE block_raw <> '' AND block_raw !~ '^[0-9]+$';
--   -- 期待: 235。この 235 件は block_exact では拾えず、C（block_number_prefix・
--   --       inferred）か D/F のフォールバックに落ちる。数値を含まない '乙' 等は
--   --       C でも拾わない（推測しない）。
--
-- ── ⑥ 式インデックスが効いていること ──────────────────────────
--   EXPLAIN ANALYZE
--   SELECT * FROM public.geo_reference_points
--   WHERE level='block' AND muni_code_5='23211'
--     AND public.geo_town_key(town_raw, subarea_raw) = '幸海町ゴ-ド'
--     AND public.geo_town_chome(town_raw) IS NOT DISTINCT FROM NULL;
--   -- 期待: geo_reference_points_match_full_idx による Index Scan
--
-- ── ⑦ RLS / 権限 ────────────────────────────────────────────
--   SELECT relrowsecurity FROM pg_class
--   WHERE oid = 'public.customer_list_row_geocodes'::regclass;              -- 期待: t
--   SELECT policyname, cmd, qual, with_check FROM pg_policies
--   WHERE schemaname='public' AND tablename='customer_list_row_geocodes'
--   ORDER BY cmd;                                                          -- 期待: clrg_* の 4 本
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_schema='public' AND table_name='customer_list_row_geocodes'
--   ORDER BY 1,2;   -- 期待: authenticated=SELECT のみ。anon は 1 件も出ない
--   SELECT p.proname, array_to_string(p.proacl, ',') FROM pg_proc p
--   JOIN pg_namespace n ON n.oid=p.pronamespace
--   WHERE n.nspname='public' AND p.proname IN (
--     'normalize_address_jp','jp_number_to_arabic','geo_town_base_raw','geo_town_chome',
--     'geo_town_base_key','geo_town_key','match_address_to_geo_point');
--   -- 期待: どれにも anon= が含まれないこと
-- =====================================================================

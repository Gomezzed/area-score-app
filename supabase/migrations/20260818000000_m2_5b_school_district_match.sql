-- =====================================================================
-- 20260818000000_m2_5b_school_district_match.sql
-- M2-5b PR#3 / SD-26: 代表点(lat/lon) → 校区（ST_Contains）突合。
--
-- 【作成のみ・DB への適用は禁止】適用は PM が Supabase コネクタで行う（R7・D57）。
--   ※ supabase db push は恒久禁止。
--
-- 本 migration が作るもの:
--   (1) 突合関数 public.match_point_to_school_districts(...)
--       ── 代表点を小学校区・中学校区に落とす。常に 2 行（elementary / junior_high）を返す。
--   (2) 突合結果テーブル public.customer_list_row_school_districts
--       ── 粒度 (row_id, school_type)。PR#2 の customer_list_row_geocodes の子。
--
-- 前提（2026-08-17 に本番 DB で実測確認済み・推測ではない）:
--   - PR#2（20260817000000_m2_5b_geocode_match）は 2026-08-17 12:55 に適用済み
--     （台帳 64 件目）。customer_list_row_geocodes は存在し、現時点 0 行。
--   - public.school_districts = 891 行 / source_version は 'R5' の 1 種のみ /
--     geom は geometry(MultiPolygon, 4326)・NOT NULL・ST_IsValid=false は 0 件 /
--     SRID 不一致 0 件 / is_public の NULL 0 件（true 427・false 464）。
--   - インデックス: school_districts_geom_gist (gist(geom)) ／
--     school_districts_muni_type_idx (muni_code_5, school_type) ／
--     school_districts_public_idx (muni_code_5, school_type) WHERE is_public。
--   - RLS: school_districts_select_public（authenticated / SELECT / is_public = true）の 1 本のみ。
--   - 収録自治体は 11 市。うち **is_public=true の 8 市は PR#2 の 8 市と完全一致**
--     （23201 豊橋 / 23202 岡崎 / 23210 刈谷 / 23211 豊田 / 23212 安城 /
--       23225 知立 / 23227 高浜 / 46201 鹿児島）＝ 8 市すべてに学区データがある。
--     残り 3 市は非公開: 23100 名古屋(PENDING) / 23203 一宮(REJECTED) / 23207 豊川(REJECTED)。
--   - 同一市×同一校種で「面積を持つ重なり」は 0 ペア（891 行を総当たりで実測）。
--     したがって包含は一意に決まるのが正常。複数当たりはデータ異常なので ambiguous に落とす。
--   - PR#2 の 11 サンプル座標は全件 小 1 件＋中 1 件にちょうど当たり、
--     境界までの距離の最小値は 67.7m（岡崎・みはらし台）。→ 閾値 50m なら全件 confirmed。
--
-- ⚠ 最重要の設計制約 ── is_public を WHERE 句に **明示** する（SD-29 の前例と意図的に違える）:
--   既存の public.get_school_districts_geojson（20260816120000）は
--   「⛔ ここに is_public フィルタは書かない。RLS が単一の真実源」と明記している。
--   本関数はその方針を **意図的に採らない**。理由は呼び手が違うから:
--     - get_school_districts_geojson の呼び手は authenticated（ブラウザ）＝ RLS が効く。
--     - 本関数の呼び手は取り込み時のサーバー側処理＝ **service_role で、RLS をバイパスする**。
--   よって RLS 単独では担保できない。ここで明示しないと、名古屋(PENDING)・一宮(REJECTED)・
--   豊川(REJECTED) の学区が突合結果として保存され、それを authenticated が SELECT できてしまう。
--   **これは可視性を緩める変更ではなく、二重に締める変更である。**
--   （SECURITY INVOKER も維持する。authenticated から呼べば RLS も併せて効く。）
--
-- ⚠ 学区名を非正規化しない（FK のみ保存する）:
--   突合結果テーブルには school_districts.id（FK）だけを持ち、school_name は保存しない。
--   後から許諾が REJECTED に転じて is_public=false になった場合、保存済みの突合結果から
--   名称を引く JOIN が RLS（school_districts_select_public）で 0 件になり、
--   **画面に出ていた学区名が自動的に消える**。名称をコピーしていると失効に追随できない。
--
-- 原則1（確定と推定を混ぜない）: match_method で経路を、match_confidence で
--   confirmed / inferred / unknown を分ける。PR#2 の match_address_to_geo_point と同じ思想。
-- =====================================================================

BEGIN;


-- =====================================================================
-- (1) 突合関数 ── 代表点 → 校区
-- =====================================================================
-- 常に 2 行（elementary, junior_high）を返す。当たらない場合も行は返す（PR#2 と同じ契約）。
--
-- 突合の階段（校種ごとに独立に評価する）:
--   a. not_geocoded             … 代表点が無い（lat/lon が NULL）              → unknown
--   b. out_of_coverage          … その(自治体×校種)に **公開**学区データが 1 件も無い → unknown
--   c. ambiguous                … 包含する公開学区が 2 件以上（データ異常）      → unknown
--   d. contains                 … 公開学区に包含され、境界まで閾値超            → confirmed
--   e. contains_near_border     … 公開学区に包含されるが境界まで閾値以内        → inferred
--   f. nearest_within_threshold … 包含なし。閾値以内に公開学区が **ちょうど 1 件** → inferred
--   g. ambiguous                … 包含なし。閾値以内に公開学区が 2 件以上        → unknown
--   h. unmatched                … 包含なし・閾値以内にも無い                    → unknown
--
-- ⚠ ST_Contains を使う（ST_Covers は使わない）:
--   ST_Contains は「境界線上ちょうどの点」を false にする。隣接学区の共有境界上の点は
--   どちらとも確定できないので、0 件 →(f)/(g) の近傍判定に落とすのが原則1に沿う。
--   ST_Covers にすると両側に当たり、静かに片方へ寄ってしまう。
--
-- ⚠ 閾値以内の候補が 2 件以上なら決めない（(g) ambiguous）:
--   PR#2 の block_number_prefix が「かつ候補が一意」を要求しているのと同じ考え方。
--   境界を挟んで 2 学区が閾値内にある点は、最近傍を採ると事実上のコイントスになる。
--   最近傍へ寄せず unknown を返し、候補数を candidate_count に残す。
--
-- ⚠ p_point_confidence による降格（必須・④）:
--   代表点が town_centroid 等の推定なら、ポリゴン内部にあっても学区は確定と呼べない。
--   'confirmed' 以外（inferred / unknown / NULL / 想定外の文字列）が渡された場合は
--   confirmed → inferred に降格する。保守側に倒すため、既定は「一致しなければ降格」。
--
-- ⚠ 距離はメートル（geography キャスト）:
--   geom は 4326（度）なので ST_Distance をそのまま使うと度になる。境界距離・近傍判定は
--   ::geography で計算する。近傍探索は先に度のバウンディングボックス && で GiST 索引を
--   効かせてから geography で厳密判定する（後述の 70000.0 の根拠もそこに書いた）。
CREATE OR REPLACE FUNCTION public.match_point_to_school_districts(
  p_lat                double precision,
  p_lon                double precision,
  p_muni_code_5        text DEFAULT NULL,
  p_point_confidence   text DEFAULT 'confirmed',
  p_border_threshold_m double precision DEFAULT 50
)
RETURNS TABLE (
  school_type        text,
  school_district_id uuid,
  match_method       text,
  match_confidence   text,
  match_reason       text,
  border_distance_m  double precision,
  near_border        boolean,
  candidate_count    integer,
  source_version     text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  -- 校種の allowlist。SD-29 と同じ 2 種のみ（compulsory は対象外）。
  v_types     text[] := ARRAY['elementary', 'junior_high'];
  v_type      text;
  v_label     text;
  v_pt        geometry(Point, 4326);
  v_thr       double precision := greatest(coalesce(p_border_threshold_m, 50), 0);
  -- 'confirmed' に厳密一致しない限り降格する（NULL・想定外文字列も降格側に倒す）。
  v_downgrade boolean := coalesce(p_point_confidence, '') IS DISTINCT FROM 'confirmed';
  v_note      text := '';
  v_has_data  boolean;
  v_n         integer;
  v_id        uuid;
  v_ver       text;
  v_dist      double precision;
  v_method    text;
  v_conf      text;
  v_reason    text;
BEGIN
  IF v_downgrade THEN
    v_note := format('。ただし代表点自体が確定ではない（point_confidence=%s）ため推定に降格',
                     coalesce(p_point_confidence, 'NULL'));
  END IF;

  -- (a) 代表点が無い ── 2 行とも not_geocoded で返す
  IF p_lat IS NULL OR p_lon IS NULL THEN
    RETURN QUERY
      SELECT t.st, NULL::uuid, 'not_geocoded'::text, 'unknown'::text,
             '代表点（緯度経度）が無いため学区突合を行わない'::text,
             NULL::double precision, NULL::boolean, 0, NULL::text
      FROM unnest(v_types) AS t(st);
    RETURN;
  END IF;

  v_pt := ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326);

  FOREACH v_type IN ARRAY v_types LOOP
    v_label := CASE v_type WHEN 'elementary' THEN '小学校区' ELSE '中学校区' END;

    -- ── (b) 収録の有無 ────────────────────────────────────────────
    -- 「この自治体×校種の公開学区が 1 件も無い」を、「データはあるが当たらない」と分ける。
    -- 未公開 3 市（名古屋・一宮・豊川）はここに落ちる。⛔ is_public IS TRUE は必須。
    SELECT EXISTS (
      SELECT 1
      FROM public.school_districts d
      WHERE d.is_public IS TRUE
        AND d.school_type = v_type
        AND (p_muni_code_5 IS NULL OR d.muni_code_5 = p_muni_code_5)
    ) INTO v_has_data;

    IF NOT v_has_data THEN
      RETURN QUERY SELECT
        v_type, NULL::uuid, 'out_of_coverage'::text, 'unknown'::text,
        format('%s の%sは公開学区データが無い（未収録または未許諾）ため突合しない',
               coalesce(p_muni_code_5, '(自治体コード未指定)'), v_label),
        NULL::double precision, NULL::boolean, 0, NULL::text;
      CONTINUE;
    END IF;

    -- ── (c)(d)(e) 包含判定 ───────────────────────────────────────
    -- count(*) OVER () は LIMIT より先に評価されるため、n は絞り込み前の真の件数。
    -- p_muni_code_5 を渡した場合は自治体内に限定する（隣接市の学区に当ててしまわない）。
    v_id := NULL; v_ver := NULL; v_dist := NULL; v_n := NULL;
    SELECT c.n, c.id, c.ver, c.dist
      INTO v_n, v_id, v_ver, v_dist
    FROM (
      SELECT count(*) OVER ()                AS n,
             d.id                            AS id,
             d.source_version                AS ver,
             ST_Distance(v_pt::geography, ST_Boundary(d.geom)::geography) AS dist
      FROM public.school_districts d
      WHERE d.is_public IS TRUE                                   -- ⛔ 緩めない（service_role は RLS をバイパスする）
        AND d.school_type = v_type
        AND (p_muni_code_5 IS NULL OR d.muni_code_5 = p_muni_code_5)
        AND ST_Contains(d.geom, v_pt)                             -- ⛔ ST_Covers にしない（境界上は 0 件に落とす）
      LIMIT 1
    ) c;
    v_n := coalesce(v_n, 0);

    IF v_n > 1 THEN
      -- 実測では 0 ペア。ここに来たら出典側の重なりを疑うべきデータ異常。
      RETURN QUERY SELECT
        v_type, NULL::uuid, 'ambiguous'::text, 'unknown'::text,
        format('この代表点を含む公開%sが %s 件あり一意に決まらないため決めない（原則1）', v_label, v_n),
        NULL::double precision, NULL::boolean, v_n, NULL::text;
      CONTINUE;
    END IF;

    IF v_n = 1 THEN
      IF v_dist > v_thr THEN
        v_method := 'contains';
        v_conf   := CASE WHEN v_downgrade THEN 'inferred' ELSE 'confirmed' END;
        v_reason := format('%sポリゴンの内部にあり、境界まで %s m（閾値 %s m）',
                           v_label, round(v_dist::numeric, 1), round(v_thr::numeric, 1)) || v_note;
        RETURN QUERY SELECT v_type, v_id, v_method, v_conf, v_reason, v_dist, false, v_n, v_ver;
      ELSE
        v_method := 'contains_near_border';
        v_conf   := 'inferred';
        v_reason := format('%sポリゴンの内部だが境界まで %s m しかない（閾値 %s m）ため推定。'
                           || '代表点は街区または町丁目の代表点であり、境界付近では実際の学区と'
                           || '食い違いうる', v_label, round(v_dist::numeric, 1), round(v_thr::numeric, 1)) || v_note;
        RETURN QUERY SELECT v_type, v_id, v_method, v_conf, v_reason, v_dist, true, v_n, v_ver;
      END IF;
      CONTINUE;
    END IF;

    -- ── (f)(g)(h) 包含なし → 閾値以内の近傍 ────────────────────────
    -- 度のバウンディングボックス && で GiST 索引を効かせてから geography で厳密判定する。
    -- 70000.0 の根拠: 経度 1 度のメートル数は 111320*cos(緯度) で、日本の最北（緯度≒45.6）でも
    -- 約 77,890 m/度。70000 で割ると必ず必要量より大きい度数になるので、
    -- バウンディングボックスが取りこぼす（偽陰性）ことはない。厳密判定は ST_DWithin が行う。
    v_id := NULL; v_ver := NULL; v_dist := NULL; v_n := NULL;
    SELECT c.n, c.id, c.ver, c.dist
      INTO v_n, v_id, v_ver, v_dist
    FROM (
      SELECT count(*) OVER ()  AS n,
             d.id              AS id,
             d.source_version  AS ver,
             ST_Distance(v_pt::geography, d.geom::geography) AS dist
      FROM public.school_districts d
      WHERE d.is_public IS TRUE                                   -- ⛔ 緩めない
        AND d.school_type = v_type
        AND (p_muni_code_5 IS NULL OR d.muni_code_5 = p_muni_code_5)
        AND d.geom && ST_Expand(v_pt, v_thr / 70000.0)
        AND ST_DWithin(d.geom::geography, v_pt::geography, v_thr)
      ORDER BY dist
      LIMIT 1
    ) c;
    v_n := coalesce(v_n, 0);

    IF v_n = 1 THEN
      v_method := 'nearest_within_threshold';
      v_conf   := 'inferred';
      v_reason := format('どの%sポリゴンにも含まれないが、閾値 %s m 以内にある公開%sが'
                         || 'ちょうど 1 件（境界まで %s m）。境界線上または境界直近の'
                         || '代表点とみなして推定で紐づけた',
                         v_label, round(v_thr::numeric, 1), v_label, round(v_dist::numeric, 1)) || v_note;
      RETURN QUERY SELECT v_type, v_id, v_method, v_conf, v_reason, v_dist, true, v_n, v_ver;
    ELSIF v_n > 1 THEN
      RETURN QUERY SELECT
        v_type, NULL::uuid, 'ambiguous'::text, 'unknown'::text,
        format('どの%sポリゴンにも含まれず、閾値 %s m 以内に公開%sが %s 件あるため'
               || '最近傍へ寄せずに決めない（原則1）',
               v_label, round(v_thr::numeric, 1), v_label, v_n),
        NULL::double precision, NULL::boolean, v_n, NULL::text;
    ELSE
      RETURN QUERY SELECT
        v_type, NULL::uuid, 'unmatched'::text, 'unknown'::text,
        format('どの公開%sポリゴンにも含まれず、閾値 %s m 以内にも無い',
               v_label, round(v_thr::numeric, 1)),
        NULL::double precision, NULL::boolean, 0, NULL::text;
    END IF;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.match_point_to_school_districts(
  double precision, double precision, text, text, double precision) IS
  'M2-5b/SD-26: 代表点(lat/lon)を小学校区・中学校区に落とす。常に 2 行（elementary/junior_high）を返す。'
  '判定は ST_Contains（ST_Covers ではない＝境界線上は包含なしに落とす）。境界まで閾値以内は '
  'contains_near_border(inferred)。包含なしで閾値以内に一意の学区があれば nearest_within_threshold(inferred)、'
  '2 件以上なら ambiguous(unknown)。p_point_confidence が confirmed でなければ confirmed→inferred に降格。'
  '⛔ WHERE 句の is_public IS TRUE は必須（呼び手の service_role は RLS をバイパスするため RLS 単独では担保できない）。';

-- deny-by-default: 新規 public 関数は anon にも EXECUTE が自動付与されるため明示的に剥がす。
REVOKE ALL ON FUNCTION public.match_point_to_school_districts(
  double precision, double precision, text, text, double precision) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_point_to_school_districts(
  double precision, double precision, text, text, double precision) FROM anon;
GRANT EXECUTE ON FUNCTION public.match_point_to_school_districts(
  double precision, double precision, text, text, double precision) TO authenticated, service_role;


-- =====================================================================
-- (2) 突合結果テーブル ── 粒度 (row_id, school_type)
-- =====================================================================
-- customer_list_row_geocodes に列を足すのではなく子テーブルにした理由:
--   ① 許諾の粒度が「自治体×校種」だから。school_district_licenses の PK は
--      (source_version, muni_code_5, school_type) で、小学校だけ CLEARED・中学校は
--      REJECTED という状態がありえる。突合結果を (row_id, school_type) 粒度にしておくと、
--      失効時の処理が school_type 指定の DELETE 1 本で済む。
--   ② 原則1。customer_list_row_geocodes の match_method/confidence/reason は
--      「住所→代表点」の確からしさ。ここに「代表点→校区」の確からしさを同居させると、
--      意味の違う confidence が 1 行に並び UI が取り違える。
--   ③ この製品は school_type を一貫して「列の値」として扱っている
--      （school_districts / school_district_licenses / get_school_districts_geojson）。
--      将来 compulsory（義務教育学校）を足すときも DDL 変更が要らない。
--   ④ 本日適用済みの customer_list_row_geocodes（CHECK 2 本＋トリガー）に触らずに済む。
CREATE TABLE IF NOT EXISTS public.customer_list_row_school_districts (
  row_id             UUID NOT NULL
                       REFERENCES public.customer_list_rows(id) ON DELETE CASCADE,
  -- SD-29 と同じ allowlist。compulsory は対象外。
  school_type        TEXT NOT NULL
                       CHECK (school_type IN ('elementary', 'junior_high')),

  -- RLS を join に依存させないための非正規化（PR#2 と同じ多層防御の流儀）。
  -- 値は BEFORE INSERT/UPDATE トリガーが親行から必ず上書きするため、ドリフトしない。
  list_id            UUID NOT NULL REFERENCES public.customer_lists(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id    UUID NOT NULL REFERENCES public.organizations(id),

  -- ── 当たった学区 ────────────────────────────────────────────────
  -- ⚠ school_name は **保存しない**（FK のみ）。許諾が REJECTED に転じて is_public=false に
  --   なると、名称を引く JOIN が RLS(school_districts_select_public) で 0 件になり、
  --   画面から学区名が自動的に消える。名称をコピーしていると失効に追随できない。
  -- ⚠ ON DELETE CASCADE:出典差し替え（source_version 更新）や失効で学区行が消えたとき、
  --   そこから導出したこの行も一緒に消えるのが正しい（SET NULL にすると下の CHECK と衝突する）。
  school_district_id UUID REFERENCES public.school_districts(id) ON DELETE CASCADE,
  source_version     TEXT,        -- 由来した KSJ ファイル版（プロベナンス・実測では 'R5'）

  -- ── 突合の根拠（原則1）────────────────────────────────────────
  match_method       TEXT NOT NULL
                       CHECK (match_method IN (
                         'contains',                 -- ポリゴン内部・境界まで閾値超
                         'contains_near_border',     -- ポリゴン内部だが境界まで閾値以内（推定）
                         'nearest_within_threshold', -- 包含なし・閾値以内に一意の学区（推定）
                         'ambiguous',                -- 候補が複数あり決めない
                         'out_of_coverage',          -- その自治体×校種に公開データが無い
                         'unmatched',                -- 包含なし・近傍にも無い
                         'not_geocoded'              -- 代表点が無い
                       )),
  match_confidence   TEXT NOT NULL
                       CHECK (match_confidence IN ('confirmed', 'inferred', 'unknown')),
  match_reason       TEXT,        -- 計算根拠。inferred の行は画面で必ず「推定」バッジと共に出す
  border_distance_m  DOUBLE PRECISION,   -- 代表点から学区境界までの距離(m)。内部/外部どちらでも境界までの距離
  near_border        BOOLEAN,            -- 境界まで閾値以内か
  candidate_count    INTEGER NOT NULL DEFAULT 0,
  -- 突合時に渡した代表点の確からしさ。confirmed でなければ結果は降格されている（④の根拠）。
  point_confidence   TEXT
                       CHECK (point_confidence IS NULL
                              OR point_confidence IN ('confirmed', 'inferred', 'unknown')),

  matched_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (row_id, school_type),

  -- 学区が特定できた行だけが confidence を持ち、距離・境界フラグ・出典版も同時に埋まる。
  CONSTRAINT clrsd_identified_consistency
    CHECK ((school_district_id IS NOT NULL) = (match_confidence <> 'unknown')
           AND (school_district_id IS NULL) = (border_distance_m IS NULL)
           AND (school_district_id IS NULL) = (near_border IS NULL)
           AND (school_district_id IS NULL) = (source_version IS NULL)),
  -- 学区を特定する 3 経路だけが FK を持つ。それ以外は必ず NULL。
  CONSTRAINT clrsd_method_consistency
    CHECK ((match_method IN ('contains', 'contains_near_border', 'nearest_within_threshold'))
           = (school_district_id IS NOT NULL)),
  -- 境界フラグは経路と 1:1（contains だけが false・推定 2 経路は true）。
  CONSTRAINT clrsd_border_flag_consistency
    CHECK ((match_method <> 'contains' OR near_border IS FALSE)
           AND (match_method NOT IN ('contains_near_border', 'nearest_within_threshold')
                OR near_border IS TRUE)),
  CONSTRAINT clrsd_distance_nonnegative
    CHECK (border_distance_m IS NULL OR border_distance_m >= 0)
);

COMMENT ON TABLE public.customer_list_row_school_districts IS
  'M2-5b/SD-26: customer_list_rows の各行の代表点を校区に落とした突合結果。粒度は (row_id, school_type)。'
  '許諾の粒度（school_district_licenses の PK = source_version, muni_code_5, school_type）に揃えてあり、'
  '失効時は school_type 指定の DELETE で失効させられる。学区名は保存せず FK のみ（REJECTED 化に自動追随）。'
  'RLS は customer_list_row_geocodes と同型（SELECT=同一 org 共有 / 書込=作成者本人 AND org 一致）。';
COMMENT ON COLUMN public.customer_list_row_school_districts.school_district_id IS
  'public.school_districts の行。学区名はここから読み取り時に JOIN して解決する（非正規化しない）。'
  '許諾が REJECTED に転じ is_public=false になると RLS により JOIN が 0 件になり、名称が自動的に消える。';
COMMENT ON COLUMN public.customer_list_row_school_districts.match_method IS
  'contains / contains_near_border / nearest_within_threshold / ambiguous / out_of_coverage / '
  'unmatched / not_geocoded。match_point_to_school_districts の返り値と 1:1。';
COMMENT ON COLUMN public.customer_list_row_school_districts.match_confidence IS
  'confirmed=ポリゴン内部かつ境界から十分離れている / inferred=境界付近または近傍推定、'
  'あるいは代表点自体が推定 / unknown=特定できず。数値スコアにはしない（原則1）。';
COMMENT ON COLUMN public.customer_list_row_school_districts.border_distance_m IS
  '代表点から学区境界までの距離(m)。geography で計算。内部なら ST_Boundary まで、外部ならポリゴンまで。';
COMMENT ON COLUMN public.customer_list_row_school_districts.point_confidence IS
  '突合時に渡した代表点（customer_list_row_geocodes.match_confidence）の値。'
  'confirmed 以外なら学区側も confirmed にはならない（推定の連鎖を confirmed に見せない）。';

CREATE INDEX IF NOT EXISTS customer_list_row_school_districts_list_idx
  ON public.customer_list_row_school_districts (list_id);
CREATE INDEX IF NOT EXISTS customer_list_row_school_districts_org_idx
  ON public.customer_list_row_school_districts (organization_id);
-- 許諾失効時に「その学区に紐づく突合結果」を引くための逆引き。
CREATE INDEX IF NOT EXISTS customer_list_row_school_districts_district_idx
  ON public.customer_list_row_school_districts (school_district_id);

-- ── 親行から所有情報を継承するトリガー ──────────────────────────────
-- PR#2 の public.set_customer_list_row_geocode_owner() を **そのまま再利用**する。
-- あの関数は NEW.row_id から親 customer_list_rows を引いて list_id/user_id/organization_id を
-- 上書きし、UPDATE 時に updated_at を触るだけで、テーブル名に依存していない。
-- 本テーブルは同じ 4 列＋updated_at を持つため要件を満たす。同型の関数を新設して
-- 二重管理にすると、片方だけ直したときに親子 org 一致の保証がずれる。
DROP TRIGGER IF EXISTS trg_set_customer_list_row_school_district_owner
  ON public.customer_list_row_school_districts;
CREATE TRIGGER trg_set_customer_list_row_school_district_owner
  BEFORE INSERT OR UPDATE ON public.customer_list_row_school_districts
  FOR EACH ROW EXECUTE FUNCTION public.set_customer_list_row_geocode_owner();

-- ── RLS（customer_list_row_geocodes と同型）───────────────────────
ALTER TABLE public.customer_list_row_school_districts ENABLE ROW LEVEL SECURITY;

-- 関数呼び出しは行ごと再評価を避けるため必ず (select ...) / IN (SELECT ...) で包む。
DROP POLICY IF EXISTS "clrsd_select_org" ON public.customer_list_row_school_districts;
CREATE POLICY "clrsd_select_org" ON public.customer_list_row_school_districts
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.current_user_org_ids()));

DROP POLICY IF EXISTS "clrsd_insert_org" ON public.customer_list_row_school_districts;
CREATE POLICY "clrsd_insert_org" ON public.customer_list_row_school_districts
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (SELECT public.current_user_org_ids())
    AND user_id = (select auth.uid())
  );

DROP POLICY IF EXISTS "clrsd_update_org" ON public.customer_list_row_school_districts;
CREATE POLICY "clrsd_update_org" ON public.customer_list_row_school_districts
  FOR UPDATE TO authenticated
  USING (
    user_id = (select auth.uid())
    AND organization_id IN (SELECT public.current_user_org_ids())
  )
  WITH CHECK (
    user_id = (select auth.uid())
    AND organization_id IN (SELECT public.current_user_org_ids())
  );

DROP POLICY IF EXISTS "clrsd_delete_org" ON public.customer_list_row_school_districts;
CREATE POLICY "clrsd_delete_org" ON public.customer_list_row_school_districts
  FOR DELETE TO authenticated
  USING (
    user_id = (select auth.uid())
    AND organization_id IN (SELECT public.current_user_org_ids())
  );

-- ── テーブル権限の最小化（PR#2 と同じ）─────────────────────────────
-- anon には一切付けない。authenticated は SELECT のみ。突合結果は取り込み時に
-- サーバー側（service_role）が算出して書く導出データであり、クライアントが直接
-- 書き換えてよい値ではない。INSERT/UPDATE/DELETE のポリシーは、将来 GRANT が
-- 変わっても行レベルで守られるよう多層防御として先に置いてある。
REVOKE ALL ON public.customer_list_row_school_districts FROM anon, authenticated;
GRANT SELECT ON public.customer_list_row_school_districts TO authenticated;

COMMIT;


-- =====================================================================
-- ロールバック SQL（適用を取り消す場合・PM が手動実行）:
--   BEGIN;
--   DROP TABLE IF EXISTS public.customer_list_row_school_districts;  -- ⚠ 突合結果も消える
--   DROP FUNCTION IF EXISTS public.match_point_to_school_districts(
--     double precision, double precision, text, text, double precision);
--   COMMIT;
--   -- ⚠ set_customer_list_row_geocode_owner() は PR#2 の資産。DROP しないこと。
-- =====================================================================


-- =====================================================================
-- 検証クエリ（適用後に手動実行）
-- =====================================================================
--
-- ── ① PR#2 の 8 市サンプル座標で校区が引けること ──────────────────
--   入力の緯度経度は PR#2 の検証節④で確定した実測値そのまま（13 ケースのうち
--   座標を持つ 11 件。残る 2 件は match_address_to_geo_point が unmatched を返し
--   代表点を持たないケースで、下の④で not_geocoded として確認する）。
--   ⚠ service_role で実行すること。authenticated でも school_districts の RLS は
--     is_public=true を通すので結果は同じになるが、本番の呼び手は service_role。
--
--   SELECT s.label, m.school_type, m.match_method, m.match_confidence,
--          d.school_name, round(m.border_distance_m::numeric, 1) AS border_m,
--          m.near_border, m.candidate_count, m.source_version
--   FROM (VALUES
--     ('豊橋・平川本町1-16',      '23201', 34.761119, 137.424702),
--     ('豊橋・大岩町菅池19',      '23201', 34.725647, 137.432869),
--     ('岡崎・上三ツ木町八ツ田2',  '23202', 34.904840, 137.132275),
--     ('岡崎・みはらし台1丁目',    '23202', 34.920591, 137.199620),
--     ('刈谷・一ツ木町',          '23210', 35.016664, 137.029172),
--     ('豊田・幸海町ゴ-ド10',      '23211', 35.085766, 137.239440),
--     ('豊田・トヨタ町',          '23211', 35.056275, 137.161408),
--     ('安城・三河安城南町1丁目',  '23212', 34.966167, 137.060033),
--     ('知立・上重原町',          '23225', 34.998483, 137.022159),
--     ('高浜・二池町1丁目',        '23227', 34.918023, 136.988928),
--     ('鹿児島・三和町',          '46201', 31.550080, 130.554298)
--   ) AS s(label, muni, lat, lon)
--   CROSS JOIN LATERAL public.match_point_to_school_districts(s.lat, s.lon, s.muni) m
--   LEFT JOIN public.school_districts d ON d.id = m.school_district_id
--   ORDER BY s.label, m.school_type;
--
--   -- 期待値（2026-08-17 に本番データへ同等クエリを流して確認した実測。全 22 行が
--   --  match_method='contains' / match_confidence='confirmed' / near_border=false /
--   --  candidate_count=1 / source_version='R5' になる。境界距離の最小は 67.7m で
--   --  閾値 50m を上回るため、1 件も contains_near_border に落ちないのが正しい）:
--   --   豊橋・平川本町1-16        小 岩田小学校      412.9 / 中 豊岡中学校    412.9
--   --   豊橋・大岩町菅池19        小 二川南小学校    146.9 / 中 二川中学校    496.1
--   --   岡崎・上三ツ木町八ツ田2   小 六ッ美中部小学校 298.0 / 中 六ツ美中学校 682.8
--   --   岡崎・みはらし台1丁目     小 緑丘小学校       67.7 / 中 竜南中学校     67.7  ← 最小
--   --   刈谷・一ツ木町            小 平成小学校      140.4 / 中 雁が音中学校  140.4
--   --   豊田・幸海町ゴ-ド10       小 幸海小学校      347.0 / 中 松平中学校    347.0
--   --   豊田・トヨタ町            小 平和小学校      300.1 / 中 豊南中学校    300.1
--   --   安城・三河安城南町1丁目   小 三河安城小学校  149.8 / 中 安城西中学校  471.9
--   --   知立・上重原町            小 知立西小学校    321.1 / 中 知立中学校    321.1
--   --   高浜・二池町1丁目         小 港小学校        243.2 / 中 南中学校      687.6
--   --   鹿児島・三和町            小 南小学校        189.5 / 中 南中学校      189.5
--
-- ── ② is_public=false の市で「校区が返らない」ことの確認 ────────────
--   入力座標は未公開 3 市の学区ポリゴンの内部点（ST_PointOnSurface の実測値）。
--   is_public を無視すれば必ず 2 件当たる点なので、0 件になれば絞り込みが効いている。
--
--   SELECT s.label, m.school_type, m.match_method, m.match_confidence,
--          m.school_district_id, m.candidate_count
--   FROM (VALUES
--     ('名古屋(PENDING)・しまだ小 内部点',  '23100', 35.108543, 136.996154),
--     ('名古屋(PENDING)・あずま中 内部点',  '23100', 35.175367, 136.926804),
--     ('一宮(REJECTED)・三条小 内部点',     '23203', 35.307327, 136.763029),
--     ('一宮(REJECTED)・中部中 内部点',     '23203', 35.301433, 136.789126),
--     ('豊川(REJECTED)・一宮南部小 内部点', '23207', 34.851549, 137.443082),
--     ('豊川(REJECTED)・一宮中 内部点',     '23207', 34.873536, 137.423608)
--   ) AS s(label, muni, lat, lon)
--   CROSS JOIN LATERAL public.match_point_to_school_districts(s.lat, s.lon, s.muni) m
--   ORDER BY s.label, m.school_type;
--   -- 期待: 全 12 行が match_method='out_of_coverage' / match_confidence='unknown' /
--   --       school_district_id IS NULL / candidate_count=0。
--   --       ⛔ 1 行でも学区 id が返ったら、WHERE 句の is_public IS TRUE が外れている。
--
--   -- 自治体コードを渡さない場合も漏れないこと（out_of_coverage ではなく unmatched になる）:
--   SELECT m.school_type, m.match_method, m.school_district_id
--   FROM public.match_point_to_school_districts(35.307327, 136.763029) m;   -- 一宮・三条小 内部点
--   -- 期待: 2 行とも unmatched / unknown / NULL。
--   --       （公開学区は全国に存在するので out_of_coverage にはならないが、
--   --         この点を含む学区はすべて is_public=false なので特定はされない）
--
--   -- 参照: is_public を無視すればこの点は必ず 2 件に当たる（絞り込みが効いている証拠）:
--   SELECT count(*) FROM public.school_districts
--   WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(136.763029, 35.307327), 4326));  -- 期待: 2
--
-- ── ③ 境界付近フラグが立つこと（閾値を上げて挙動を見る）──────────────
--   閾値を 100m にすると、①で境界まで 67.7m だった岡崎・みはらし台だけが
--   contains → contains_near_border（inferred）へ落ちる。
--
--   SELECT m.school_type, m.match_method, m.match_confidence, m.near_border,
--          round(m.border_distance_m::numeric, 1) AS border_m
--   FROM public.match_point_to_school_districts(34.920591, 137.199620, '23202', 'confirmed', 100) m;
--   -- 期待: 2 行とも contains_near_border / inferred / near_border=t / border_m=67.7
--   -- 既定の 50m では contains / confirmed に戻ること:
--   SELECT m.school_type, m.match_method, m.match_confidence, m.near_border
--   FROM public.match_point_to_school_districts(34.920591, 137.199620, '23202') m;
--   -- 期待: 2 行とも contains / confirmed / near_border=f
--
-- ── ④ p_point_confidence による降格が効いていること（④の必須確認）────
--   包含（contains）していても、代表点自体が推定なら confirmed にしない。
--
--   SELECT m.school_type, m.match_method, m.match_confidence, m.match_reason
--   FROM public.match_point_to_school_districts(
--          34.761119, 137.424702, '23201', 'inferred') m;      -- 豊橋・平川本町1-16
--   -- 期待: 2 行とも match_method='contains'（経路は変わらない）だが
--   --       match_confidence='inferred'（confirmed から降格）。
--   --       match_reason の末尾に「代表点自体が確定ではない（point_confidence=inferred）ため
--   --       推定に降格」が付くこと。
--   -- 同じ点で 'confirmed' を渡せば confirmed に戻ること（対照）:
--   SELECT m.match_confidence
--   FROM public.match_point_to_school_districts(34.761119, 137.424702, '23201', 'confirmed') m;
--   -- 期待: 2 行とも confirmed
--   -- 想定外の値・NULL も保守側（降格）に倒れること:
--   SELECT m.match_confidence
--   FROM public.match_point_to_school_districts(34.761119, 137.424702, '23201', NULL) m;
--   -- 期待: 2 行とも inferred
--   -- 代表点が無い場合:
--   SELECT m.school_type, m.match_method, m.match_confidence
--   FROM public.match_point_to_school_districts(NULL, NULL, '23201') m;
--   -- 期待: 2 行とも not_geocoded / unknown
--
-- ── ⑤ ST_Contains が索引を使っていること ─────────────────────────
--   EXPLAIN ANALYZE
--   SELECT d.id FROM public.school_districts d
--   WHERE d.is_public IS TRUE AND d.school_type = 'elementary' AND d.muni_code_5 = '23211'
--     AND ST_Contains(d.geom, ST_SetSRID(ST_MakePoint(137.239440, 35.085766), 4326));
--   -- 期待: school_districts_geom_gist による Index Scan（または
--   --       school_districts_public_idx による絞り込み後の再チェック）。Seq Scan なら要調査。
--
-- ── ⑥ データ健全性（前提が崩れていないこと）────────────────────────
--   SELECT count(*) FILTER (WHERE NOT ST_IsValid(geom)) AS invalid,
--          count(*) FILTER (WHERE ST_SRID(geom) <> 4326) AS bad_srid,
--          count(*) FILTER (WHERE is_public IS NULL)     AS is_public_null,
--          count(DISTINCT source_version)                AS versions
--   FROM public.school_districts;   -- 期待: 0 / 0 / 0 / 1
--
--   -- 同一市×同一校種で面積を持つ重なりが無いこと（あると ambiguous が出る）:
--   SELECT count(*) FROM public.school_districts a JOIN public.school_districts b
--     ON a.school_type = b.school_type AND a.muni_code_5 = b.muni_code_5 AND a.id < b.id
--    AND ST_Intersects(a.geom, b.geom) AND ST_Area(ST_Intersection(a.geom, b.geom)) > 0;
--   -- 期待: 0
--
-- ── ⑦ RLS / 権限 ────────────────────────────────────────────
--   SELECT relrowsecurity FROM pg_class
--   WHERE oid = 'public.customer_list_row_school_districts'::regclass;      -- 期待: t
--   SELECT policyname, cmd FROM pg_policies
--   WHERE schemaname='public' AND tablename='customer_list_row_school_districts'
--   ORDER BY cmd;                                                          -- 期待: clrsd_* の 4 本
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_schema='public' AND table_name='customer_list_row_school_districts'
--   ORDER BY 1,2;   -- 期待: authenticated=SELECT のみ。anon は 1 件も出ない
--   SELECT p.proname, array_to_string(p.proacl::text[], ' | ') AS acl
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='public' AND p.proname = 'match_point_to_school_districts';
--   -- 期待: acl に anon= が含まれないこと（authenticated=X / service_role=X のみ）
--   -- anon は EXECUTE 拒否:
--   SET ROLE anon;
--   SELECT * FROM public.match_point_to_school_districts(34.761119, 137.424702, '23201');
--   -- 期待: ERROR: permission denied for function match_point_to_school_districts
--   RESET ROLE;
--
--   -- トリガーが PR#2 の関数を指していること:
--   SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
--   WHERE tgrelid = 'public.customer_list_row_school_districts'::regclass AND NOT tgisinternal;
--   -- 期待: trg_set_customer_list_row_school_district_owner が
--   --       EXECUTE FUNCTION public.set_customer_list_row_geocode_owner() を指す
-- =====================================================================

// ============================================================
// 顧客名簿 CSV のパース & 列マッピング自動検出（React 非依存の純ロジック）。
//   - RFC4180 準拠の最小パーサ（引用符・エスケープ・改行/カンマ内包・CRLF・BOM）。
//   - ヘッダ行から論理列（反響日時/顧客名/住所/…）を推定する。
//   依存ゼロ。API 層（Route Handler）からもテストからも同じ関数を使う。
// ============================================================

import type { ColumnMapping, CustomerColumnKey } from './types.ts'

// CSV 本文を行×セルの二次元配列へパースする。
//   - 先頭 BOM は除去。改行は CRLF/LF 両対応。
//   - 引用符内のカンマ・改行・"" エスケープに対応。
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  // 先頭 BOM 除去
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++ // エスケープされた引用符
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }
    if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c === '\r') {
      // CRLF の \r は無視（次の \n で確定）。単独 CR も行区切りとして扱う。
      if (s[i + 1] !== '\n') {
        row.push(field)
        rows.push(row)
        row = []
        field = ''
      }
    } else {
      field += c
    }
  }
  // 末尾フィールド/行（末尾改行が無い場合）
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  // 完全な空行（1セルで空）は除去
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''))
}

// 論理列ごとのヘッダ検出キーワード（部分一致・優先度は配列順）。
//   ⚠ external_id を先頭に置く: 「顧客番号」は customer_name の '顧客名' には
//      部分一致しない（'顧客番号'.includes('顧客名') === false）ため衝突しないが、
//      UPSERT キーの取り違えは事故が大きいので最優先で確定させる。
const HEADER_KEYWORDS: Record<CustomerColumnKey, string[]> = {
  external_id: ['顧客番号', '顧客ID', '顧客コード', '会員番号'],
  inquiry_at: ['反響日', '反響日時', '反響'],
  customer_name: ['顧客名', '氏名', 'お名前', '名前'],
  media: ['媒体', '反響媒体', '流入', '経路'],
  address: ['住所', '所在'],
  phone: ['電話', 'TEL', 'tel', '電話番号'],
  last_contact_at: ['最終接触', '最終接触日', '最終', '最終連絡'],
  category: ['種別', '区分', 'カテゴリ'],
  assignee: ['担当', '担当者'],
}

// ヘッダ行から論理列 → 列インデックスのマッピングを推定する。
//   - 各論理列につき、最初に一致したヘッダの列番号を採用。
//   - address は突合の必須列。検出できなければ呼び出し側で 400 とする。
export function detectColumnMapping(header: string[]): ColumnMapping {
  const norm = header.map((h) => (h ?? '').normalize('NFKC').trim())
  const mapping: ColumnMapping = {}
  const used = new Set<number>()

  // 長いキーワードから当てると誤検出しにくいが、ここでは列ごとに走査する。
  ;(Object.keys(HEADER_KEYWORDS) as CustomerColumnKey[]).forEach((key) => {
    const keywords = HEADER_KEYWORDS[key]
    for (const kw of keywords) {
      const idx = norm.findIndex((h, i) => !used.has(i) && h.includes(kw))
      if (idx >= 0) {
        mapping[key] = idx
        used.add(idx)
        break
      }
    }
  })

  return mapping
}

// マッピングに従い1データ行から値を取り出すヘルパ。列が無ければ空文字。
export function cellOf(
  row: string[],
  mapping: ColumnMapping,
  key: CustomerColumnKey,
): string {
  const idx = mapping[key]
  if (idx == null) return ''
  return (row[idx] ?? '').trim()
}

// 日付文字列を ISO(TIMESTAMPTZ 相当) へ緩くパースする。
//   失敗時は null（DB の inquiry_at/last_contact_at は nullable）。
//   "2026/08/01" "2026-08-01" "2026年8月1日" 等に対応。
export function parseDateLoose(input: string | null | undefined): string | null {
  if (!input) return null
  const s = input.normalize('NFKC').trim()
  if (!s) return null
  // 和暦記号を区切りに寄せる
  const cleaned = s
    .replace(/年|月/g, '/')
    .replace(/日/g, '')
    .replace(/\./g, '/')
    .replace(/-/g, '/')
  const m = cleaned.match(/^(\d{4})\/(\d{1,2})(?:\/(\d{1,2}))?/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = m[3] ? Number(m[3]) : 1
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const iso = `${y.toString().padStart(4, '0')}-${mo
    .toString()
    .padStart(2, '0')}-${d.toString().padStart(2, '0')}`
  return `${iso}T00:00:00Z`
}

// 日付パースの結果。value が null のとき reason に「なぜ null なのか」が入る。
//   原則1: どの書式にも一致しなければ推測せず NULL にし、根拠を必ず残す。
export interface ParsedDate {
  value: string | null
  // null = 未入力（そもそも値が無い＝失敗ではない）
  // 'date_unparsed'  = 値はあるがどの書式にも一致しない
  // 'date_invalid'   = 書式は合うが暦として存在しない（2026/02/30 等）
  reason: 'date_unparsed' | 'date_invalid' | null
}

// 複数書式を試行し、一致しなければ推測せず NULL + reason を返す（O44・原則1）。
//   対応: YYYY/M/D・YYYY-M-D・YYYY.M.D・YYYY年M月D日・YYYY/M（日は1日）
//         いずれにも「HH:MM(:SS)」の時刻を付けられる。
//   ⚠ タイムゾーン: v0（parseDateLoose）と同じく UTC（Z）として組み立てる。
//      CSV の時刻が JST 実時刻である可能性は高いが、ここで +09:00 を仮定すると
//      v0 で取り込み済みの既存行と基準がズレる。TZ の確定は PR-C 以降の課題として
//      据え置き、本 PR では既存挙動との一貫性を優先する。
export function parseDateWithReason(input: string | null | undefined): ParsedDate {
  if (input == null) return { value: null, reason: null }
  const s = input.normalize('NFKC').trim()
  if (!s) return { value: null, reason: null }

  // 和暦記号・区切りを '/' に寄せ、'日' は時刻との区切り（空白）にする。
  const cleaned = s
    .replace(/[年月]/g, '/')
    .replace(/日/g, ' ')
    .replace(/[.\-]/g, '/')
    .trim()
  const m = cleaned.match(
    /^(\d{4})\/(\d{1,2})(?:\/(\d{1,2}))?(?:[ T]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/,
  )
  if (!m) return { value: null, reason: 'date_unparsed' }

  const y = Number(m[1])
  const mo = Number(m[2])
  const d = m[3] ? Number(m[3]) : 1
  const hh = m[4] ? Number(m[4]) : 0
  const mi = m[5] ? Number(m[5]) : 0
  const ss = m[6] ? Number(m[6]) : 0

  // 暦として存在するかを UTC で往復検証する（2026/02/30 等を弾く）。
  const t = Date.UTC(y, mo - 1, d, hh, mi, ss)
  const dt = new Date(t)
  if (
    Number.isNaN(t) ||
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d ||
    dt.getUTCHours() !== hh ||
    dt.getUTCMinutes() !== mi ||
    dt.getUTCSeconds() !== ss
  ) {
    return { value: null, reason: 'date_invalid' }
  }
  const p2 = (n: number) => n.toString().padStart(2, '0')
  return {
    value: `${y.toString().padStart(4, '0')}-${p2(mo)}-${p2(d)}T${p2(hh)}:${p2(mi)}:${p2(ss)}Z`,
    reason: null,
  }
}

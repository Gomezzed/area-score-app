// ============================================================
// CSV バイト列 → 文字列のデコード（O44: UTF-8 / cp932 の両対応）。
//   ⚠ この処理はサーバーで「生バイト」に対して行う必要がある。
//      ブラウザの File.text() は常に UTF-8 として解釈するため、そこを通すと
//      cp932(Shift_JIS) のバイト列は到達前に文字化けが確定し復元できない。
//      → 取込ルートは application/octet-stream で ArrayBuffer を受ける。
//   依存ゼロ（React/DB 非依存）。テストからも同じ関数を使う。
// ============================================================

// 検出したエンコーディング（レスポンスに載せて運用時の切り分けに使う）。
export type CsvEncoding = 'utf-8' | 'utf-8-bom' | 'shift_jis'

// デコード不能（UTF-16 等の非対応エンコーディング）。呼び出し側で 400 にする。
export class CsvDecodeError extends Error {
  readonly code: 'unsupported_encoding'
  constructor(message: string) {
    super(message)
    this.name = 'CsvDecodeError'
    this.code = 'unsupported_encoding'
  }
}

// UTF-8 BOM。parseCsv 側でも先頭 BOM は除去されるが、判定にはここで使う。
function hasUtf8Bom(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  )
}

// UTF-16 の BOM（FF FE / FE FF）。Excel の「Unicode テキスト」形式など。
//   推測でデコードすると全文字化けするため、推測せず明示的に弾く（原則1）。
function hasUtf16Bom(bytes: Uint8Array): boolean {
  if (bytes.length < 2) return false
  return (
    (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)
  )
}

// バイト列を CSV 本文の文字列へデコードする。
//   ① UTF-16 BOM は非対応として即エラー（文字化けを黙って通さない）
//   ② UTF-8 を fatal:true で試行（不正バイトがあれば必ず例外になる）
//   ③ 例外なら cp932(Shift_JIS) として読み直す
//   ⚠ WHATWG のラベルは 'shift_jis'。'cp932' はラベルとして無効で
//      TextDecoder が RangeError を投げる（実測済み）。Windows-31J の
//      マッピングは 'shift_jis' ラベルで得られる。
export function decodeCsvBytes(bytes: Uint8Array): {
  text: string
  encoding: CsvEncoding
} {
  if (hasUtf16Bom(bytes)) {
    throw new CsvDecodeError('UTF-16 CSV is not supported')
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { text, encoding: hasUtf8Bom(bytes) ? 'utf-8-bom' : 'utf-8' }
  } catch {
    // UTF-8 として不正 → cp932 とみなす。ここは fatal:false（cp932 は
    // 未定義バイトでも実務ファイルに混在するため、置換文字を許容して読み切る）。
    const text = new TextDecoder('shift_jis').decode(bytes)
    return { text, encoding: 'shift_jis' }
  }
}

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

// ============================================================
// リフレッシュトークン等の機微情報を DB 保存する際の対称暗号ユーティリティ。
//   AES-256-GCM（認証付き暗号）。鍵は環境変数 INTEGRATIONS_TOKEN_KEY
//   （base64 エンコードされた 32 バイト）から取得する。
//   保存形式は "iv:ciphertext:tag"（各要素 base64）の連結文字列。
//
//   ※ サーバー専用。クライアントへは絶対に import しない
//     （Node 標準 crypto に依存し、鍵はサーバー環境変数のみ）。
// ============================================================

const ALGORITHM = 'aes-256-gcm'
// GCM の推奨 IV 長は 12 バイト。
const IV_LENGTH = 12
const KEY_LENGTH = 32

function getKey(): Buffer {
  const b64 = process.env.INTEGRATIONS_TOKEN_KEY
  if (!b64) {
    throw new Error('INTEGRATIONS_TOKEN_KEY is not set')
  }
  const key = Buffer.from(b64, 'base64')
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `INTEGRATIONS_TOKEN_KEY must decode to ${KEY_LENGTH} bytes (got ${key.length})`,
    )
  }
  return key
}

// 平文 → "iv:ciphertext:tag"（各 base64）。
export function encryptToken(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return [
    iv.toString('base64'),
    ciphertext.toString('base64'),
    tag.toString('base64'),
  ].join(':')
}

// "iv:ciphertext:tag" → 平文。改ざん検知時は例外を送出する。
export function decryptToken(payload: string): string {
  const key = getKey()
  const parts = payload.split(':')
  if (parts.length !== 3) {
    throw new Error('invalid encrypted token format')
  }
  const [ivB64, ctB64, tagB64] = parts
  const iv = Buffer.from(ivB64, 'base64')
  const ciphertext = Buffer.from(ctB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8')
}

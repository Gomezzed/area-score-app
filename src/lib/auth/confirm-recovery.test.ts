// confirm-recovery のユニットテスト（依存ゼロ・Node 標準テストランナー）。
//   実行: npm test  （= node --test src/lib/auth/confirm-recovery.test.ts）
//
// O52 / A 案の要件を純ロジックで担保する:
//   - token_hash 不在・不正 type は verifyOtp を呼ばず invalid で弾く
//   - 押下相当（consumeRecovery）は verifyOtp をちょうど1回・正しい引数で呼ぶ
//   - 失敗コードの reason 丸めが現行踏襲
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateConfirmParams,
  classifyOtpError,
  consumeRecovery,
  type VerifyOtpFn,
} from './confirm-recovery.ts'

test('validateConfirmParams: recovery + token_hash は ok', () => {
  const r = validateConfirmParams('abc123', 'recovery')
  assert.deepEqual(r, { ok: true, tokenHash: 'abc123' })
})

test('validateConfirmParams: token_hash 不在は invalid', () => {
  assert.deepEqual(validateConfirmParams(null, 'recovery'), { ok: false, reason: 'invalid' })
  assert.deepEqual(validateConfirmParams('', 'recovery'), { ok: false, reason: 'invalid' })
  assert.deepEqual(validateConfirmParams(undefined, 'recovery'), { ok: false, reason: 'invalid' })
})

test('validateConfirmParams: recovery 以外の type は invalid（signup/invite/email_change/null）', () => {
  for (const t of ['signup', 'invite', 'email_change', 'magiclink', 'email', null, undefined]) {
    assert.deepEqual(validateConfirmParams('abc123', t), { ok: false, reason: 'invalid' })
  }
})

test('classifyOtpError: otp_expired は expired', () => {
  assert.equal(classifyOtpError({ code: 'otp_expired' }), 'expired')
})

test('classifyOtpError: 判別不能はすべて expired に寄せる（現行踏襲）', () => {
  assert.equal(classifyOtpError({ code: 'something_else' }), 'expired')
  assert.equal(classifyOtpError({}), 'expired')
})

test('consumeRecovery: 成功時は null を返し verifyOtp をちょうど1回・正しい引数で呼ぶ', async () => {
  const calls: Array<{ type: string; token_hash: string }> = []
  const verify: VerifyOtpFn = async (params) => {
    calls.push(params)
    return { error: null }
  }
  const reason = await consumeRecovery(verify, 'tok-xyz')
  assert.equal(reason, null)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { type: 'recovery', token_hash: 'tok-xyz' })
})

test('consumeRecovery: 失敗時は reason を返し呼び出しは1回のみ', async () => {
  let count = 0
  const verify: VerifyOtpFn = async () => {
    count += 1
    return { error: { code: 'otp_expired' } }
  }
  const reason = await consumeRecovery(verify, 'tok-xyz')
  assert.equal(reason, 'expired')
  assert.equal(count, 1)
})

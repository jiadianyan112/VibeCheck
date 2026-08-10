import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { decryptText, encryptText, hashOtp, keyedHash, verifyHash } from './crypto.js'
import { canUseReturnTo, maskEmail, normalizeEmail, normalizeReturnTo } from './normalize.js'

const encryptionKey = Buffer.alloc(32, 7).toString('base64')

describe('identity cryptography and normalization', () => {
  it('encrypts reversible email data while keeping deterministic lookups keyed', () => {
    const encrypted = encryptText(encryptionKey, 'user@example.com')
    assert.notEqual(encrypted.toString('utf8'), 'user@example.com')
    assert.equal(decryptText(encryptionKey, encrypted), 'user@example.com')
    assert.deepEqual(keyedHash('pepper', 'user@example.com'), keyedHash('pepper', 'user@example.com'))
    assert.notDeepEqual(keyedHash('pepper-a', 'user@example.com'), keyedHash('pepper-b', 'user@example.com'))
  })

  it('uses salted OTP hashes and timing-safe equality', () => {
    const salt = Buffer.alloc(16, 3)
    const expected = hashOtp('otp-pepper', salt, '012345')
    assert.equal(verifyHash(expected, hashOtp('otp-pepper', salt, '012345')), true)
    assert.equal(verifyHash(expected, hashOtp('otp-pepper', salt, '999999')), false)
  })

  it('normalizes addresses and restricts login return targets', () => {
    assert.equal(normalizeEmail(' User@例子.com '), 'user@xn--fsqu00a.com')
    assert.equal(maskEmail('user@example.com'), 'us***@example.com')
    assert.equal(normalizeReturnTo('/search?q=quiz#results'), '/search?q=quiz#results')
    assert.equal(normalizeReturnTo('https://attacker.example'), '/me')
    assert.equal(normalizeReturnTo('//attacker.example'), '/me')
    assert.equal(canUseReturnTo('/admin/reviews', ['user']), false)
    assert.equal(canUseReturnTo('/admin/reviews', ['editor']), true)
    assert.throws(() => normalizeEmail('not-an-email'), /EMAIL_INVALID/)
  })
})

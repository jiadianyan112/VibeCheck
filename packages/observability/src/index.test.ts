import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { redactRecord } from './index.js'

describe('redactRecord', () => {
  it('redacts security and privacy fields without mutating safe fields', () => {
    const result = redactRecord({
      request_id: 'req-1',
      otp: '123456',
      normalized_email: 'person@example.com',
      status: 'ok',
    })

    assert.deepEqual(result, {
      request_id: 'req-1',
      otp: '[REDACTED]',
      normalized_email: '[REDACTED]',
      status: 'ok',
    })
  })
})

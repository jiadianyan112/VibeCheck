import assert from 'node:assert/strict'
import { it } from 'node:test'
import { canSetPasswordFromSession } from './password-store.js'

it('permits password changes only during the five minutes after OTP login', () => {
  const now = new Date('2026-09-25T00:05:00.000Z')
  assert.equal(canSetPasswordFromSession('email_otp', new Date('2026-09-25T00:00:00.000Z'), now), true)
  assert.equal(canSetPasswordFromSession('email_otp', new Date('2026-09-24T23:59:59.999Z'), now), false)
  assert.equal(canSetPasswordFromSession('email_password', new Date('2026-09-25T00:04:00.000Z'), now), false)
  assert.equal(canSetPasswordFromSession('email_otp', new Date('2026-09-25T00:06:00.000Z'), now), false)
  assert.equal(canSetPasswordFromSession('email_otp', null, now), false)
})

import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { PostgresPasswordStore } from '../password-store.js'

if (process.env.NODE_ENV === 'production') throw new Error('PASSWORD_FIXTURE_PRODUCTION_FORBIDDEN')
const connectionString = process.env.DATABASE_URL?.trim()
if (!connectionString) throw new Error('CONFIG_DATABASE_URL_REQUIRED')

const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  application_name: 'vibecheck-password-store-fixture',
  max: 2,
})

try {
  const store = new PostgresPasswordStore(pool)
  const emailHash = randomBytes(32)
  const ipHash = randomBytes(32)
  const sessionHash = randomBytes(32)
  const now = new Date()
  assert.equal(await store.consumeAttempt(emailHash, ipHash, now, 900), true)
  assert.equal(await store.findCredential(emailHash), null)
  assert.deepEqual(await store.getStatus(randomUUID(), sessionHash, now), {
    hasPassword: false,
    canSetPassword: false,
  })
  assert.equal(await store.setPassword({
    userId: randomUUID(), sessionHash, passwordHash: 'unused', now, requestId: randomUUID(),
  }), false)
  process.stdout.write('password_store_fixture_ok\n')
} finally {
  await pool.end()
}

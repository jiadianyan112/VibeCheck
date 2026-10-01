import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SearchError } from './errors.js'
import { SearchCrypto } from './crypto.js'

const key = Buffer.alloc(32, 7).toString('base64')
const pepper = 'search-subject-hash-pepper-at-least-32-characters'
const tokenSecret = 'search-result-token-secret-at-least-32-characters'

test('query envelope encryption round-trips without plaintext or deterministic ciphertext', () => {
  const crypto = new SearchCrypto(key, 'test-v1', pepper, tokenSecret)
  const queryId = '90000000-0000-4000-8000-000000000001'
  const plaintext = '面向学生的学习反馈工具'
  const owner = crypto.subjectHash({ kind: 'anonymous', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })
  const other = crypto.subjectHash({ kind: 'anonymous', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })
  const first = crypto.encryptQuery(queryId, plaintext, owner)
  const second = crypto.encryptQuery(queryId, plaintext, owner)
  assert.equal(crypto.decryptQuery(queryId, first, 'test-v1', owner), plaintext)
  assert.notDeepEqual(first.ciphertext, second.ciphertext)
  assert.equal(first.ciphertext.includes(Buffer.from(plaintext, 'utf8')), false)
  assert.throws(
    () => crypto.decryptQuery('90000000-0000-4000-8000-000000000002', first, 'test-v1', owner),
    (error: unknown) => error instanceof SearchError && error.code === 'QUERY_SNAPSHOT_DECRYPT_FAILED',
  )
  assert.throws(() => crypto.decryptQuery(queryId, first, 'test-v1', other), SearchError)
})

test('opaque tokens are bound to the current search subject', () => {
  const crypto = new SearchCrypto(key, 'test-v1', pepper, tokenSecret)
  const owner = crypto.subjectHash({ kind: 'anonymous', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })
  const other = crypto.subjectHash({ kind: 'anonymous', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })
  const token = crypto.signOpaquePayload(Object.freeze({ type: 'search_cursor.v1', offset: 20 }), owner)
  assert.equal(crypto.verifyOpaquePayload(token, owner).offset, 20)
  assert.throws(
    () => crypto.verifyOpaquePayload(token, other),
    (error: unknown) => error instanceof SearchError && error.code === 'SEARCH_TOKEN_INVALID',
  )
})

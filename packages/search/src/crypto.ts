import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

import { searchError } from './errors.js'
import type { SearchSubject } from './types.js'

export interface EncryptedQuery {
  readonly encryptedDataKey: Buffer
  readonly dataKeyIv: Buffer
  readonly dataKeyAuthTag: Buffer
  readonly ciphertext: Buffer
  readonly iv: Buffer
  readonly authTag: Buffer
}

interface CipherResult {
  readonly ciphertext: Buffer
  readonly iv: Buffer
  readonly authTag: Buffer
}

function cipher(key: Buffer, plaintext: Buffer, aad: string): CipherResult {
  const iv = randomBytes(12)
  const instance = createCipheriv('aes-256-gcm', key, iv)
  instance.setAAD(Buffer.from(aad, 'utf8'))
  const ciphertext = Buffer.concat([instance.update(plaintext), instance.final()])
  return Object.freeze({ ciphertext, iv, authTag: instance.getAuthTag() })
}

function decipher(key: Buffer, encrypted: CipherResult, aad: string): Buffer {
  try {
    const instance = createDecipheriv('aes-256-gcm', key, encrypted.iv)
    instance.setAAD(Buffer.from(aad, 'utf8'))
    instance.setAuthTag(encrypted.authTag)
    return Buffer.concat([instance.update(encrypted.ciphertext), instance.final()])
  } catch {
    throw searchError('QUERY_SNAPSHOT_DECRYPT_FAILED', 500)
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export class SearchCrypto {
  private readonly masterKey: Buffer

  constructor(
    encryptionMasterKey: string,
    private readonly encryptionKeyVersion: string,
    private readonly subjectHashPepper: string,
    private readonly resultTokenSecret: string,
  ) {
    this.masterKey = Buffer.from(encryptionMasterKey, 'base64')
    if (this.masterKey.length !== 32 || this.masterKey.toString('base64') !== encryptionMasterKey) {
      throw new Error('SEARCH_ENCRYPTION_KEY_INVALID')
    }
    if (encryptionKeyVersion.length < 1 || encryptionKeyVersion.length > 64) {
      throw new Error('SEARCH_ENCRYPTION_KEY_VERSION_INVALID')
    }
    if (subjectHashPepper.length < 32 || resultTokenSecret.length < 32) {
      throw new Error('SEARCH_SECRET_INVALID')
    }
  }

  encryptQuery(queryId: string, rawQuery: string, ownerSubjectHash: Buffer): EncryptedQuery {
    const ownerBinding = ownerSubjectHash.toString('hex')
    const dataKey = randomBytes(32)
    const wrapped = cipher(
      this.masterKey,
      dataKey,
      `vibecheck:search:data-key:${this.encryptionKeyVersion}:${queryId}:${ownerBinding}`,
    )
    const encrypted = cipher(
      dataKey,
      Buffer.from(rawQuery, 'utf8'),
      `vibecheck:search:query:${queryId}:${ownerBinding}`,
    )
    dataKey.fill(0)
    return Object.freeze({
      encryptedDataKey: wrapped.ciphertext,
      dataKeyIv: wrapped.iv,
      dataKeyAuthTag: wrapped.authTag,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    })
  }

  decryptQuery(
    queryId: string,
    encrypted: EncryptedQuery,
    keyVersion: string,
    ownerSubjectHash: Buffer,
  ): string {
    if (keyVersion !== this.encryptionKeyVersion) throw searchError('QUERY_KEY_VERSION_UNAVAILABLE', 500)
    const ownerBinding = ownerSubjectHash.toString('hex')
    const dataKey = decipher(this.masterKey, {
      ciphertext: encrypted.encryptedDataKey,
      iv: encrypted.dataKeyIv,
      authTag: encrypted.dataKeyAuthTag,
    }, `vibecheck:search:data-key:${keyVersion}:${queryId}:${ownerBinding}`)
    const plaintext = decipher(dataKey, {
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    }, `vibecheck:search:query:${queryId}:${ownerBinding}`)
    dataKey.fill(0)
    return plaintext.toString('utf8')
  }

  keyVersion(): string {
    return this.encryptionKeyVersion
  }

  subjectHash(subject: SearchSubject): Buffer {
    return createHmac('sha256', this.subjectHashPepper)
      .update(`${subject.kind}:${subject.id}`, 'utf8')
      .digest()
  }

  queryHash(rawQuery: string): Buffer {
    return createHmac('sha256', this.subjectHashPepper)
      .update(`query:${rawQuery}`, 'utf8')
      .digest()
  }

  fingerprint(value: unknown): Buffer {
    return createHash('sha256').update(canonical(value), 'utf8').digest()
  }

  rateLimitHash(value: string): Buffer {
    return createHmac('sha256', this.subjectHashPepper).update(`rate:${value}`, 'utf8').digest()
  }

  signOpaquePayload(payload: Readonly<Record<string, unknown>>, subjectHash: Buffer): string {
    const encoded = Buffer.from(canonical(payload), 'utf8').toString('base64url')
    const signature = createHmac('sha256', this.resultTokenSecret)
      .update(encoded, 'utf8')
      .update(subjectHash)
      .digest('base64url')
    return `${encoded}.${signature}`
  }

  verifyOpaquePayload(token: string, subjectHash: Buffer): Readonly<Record<string, unknown>> {
    const [encoded, supplied, extra] = token.split('.')
    if (!encoded || !supplied || extra !== undefined) throw searchError('SEARCH_TOKEN_INVALID', 400)
    const expected = createHmac('sha256', this.resultTokenSecret)
      .update(encoded, 'utf8')
      .update(subjectHash)
      .digest('base64url')
    const suppliedBuffer = Buffer.from(supplied, 'utf8')
    const expectedBuffer = Buffer.from(expected, 'utf8')
    if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
      throw searchError('SEARCH_TOKEN_INVALID', 400)
    }
    try {
      const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error()
      return Object.freeze(value as Record<string, unknown>)
    } catch {
      throw searchError('SEARCH_TOKEN_INVALID', 400)
    }
  }
}

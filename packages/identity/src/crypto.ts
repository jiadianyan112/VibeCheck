import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto'

export function opaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function sixDigitOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

export function keyedHash(secret: string, value: string): Buffer {
  return createHmac('sha256', secret).update(value, 'utf8').digest()
}

export function hashOtp(secret: string, salt: Buffer, otp: string): Buffer {
  return createHmac('sha256', secret)
    .update(salt)
    .update(':', 'utf8')
    .update(otp, 'utf8')
    .digest()
}

export function verifyHash(expected: Buffer, actual: Buffer): boolean {
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function encryptText(base64Key: string, plaintext: string): Buffer {
  const key = Buffer.from(base64Key, 'base64')
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext])
}

export function decryptText(base64Key: string, encrypted: Buffer): string {
  if (encrypted.length < 29) throw new Error('EMAIL_CIPHERTEXT_INVALID')
  const key = Buffer.from(base64Key, 'base64')
  const nonce = encrypted.subarray(0, 12)
  const tag = encrypted.subarray(12, 28)
  const ciphertext = encrypted.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

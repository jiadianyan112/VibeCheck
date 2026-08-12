import { createCipheriv, randomBytes } from 'node:crypto'

export function encryptCommunityText(base64Key: string, plaintext: string): Buffer {
  const key = Buffer.from(base64Key, 'base64')
  if (key.length !== 32 || key.toString('base64') !== base64Key) {
    throw new Error('COMMUNITY_ENCRYPTION_KEY_INVALID')
  }
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext])
}

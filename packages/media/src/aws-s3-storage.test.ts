import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import sharp from 'sharp'

import { MediaError } from './errors.js'
import { R2MediaStorage, type R2MediaConfig, type S3MediaClient } from './aws-s3-storage.js'

const config: R2MediaConfig = Object.freeze({
  endpoint: 'https://account-id.r2.cloudflarestorage.com',
  region: 'auto', bucket: 'fixture-bucket', objectPrefix: 'public-media/',
})
const storageKey = 'quarantine/92000000-0000-4000-8000-000000000002/92000000-0000-4000-8000-000000000001'
const finalStorageKey = 'ready/92000000-0000-4000-8000-000000000002/92000000-0000-4000-8000-000000000001'

function checksum(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function inputFor(body: Uint8Array, overrides: Partial<{
  declaredMime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif'
  byteSize: number
  checksumSha256: string
}> = {}) {
  return {
    storageKey, mediaResourceId: '92000000-0000-4000-8000-000000000001',
    ownerUserId: '92000000-0000-4000-8000-000000000002', declaredMime: 'image/png' as const,
    byteSize: body.byteLength, checksumSha256: checksum(body), ...overrides,
  }
}

function bodyClient(body: Uint8Array, onCommand?: (command: unknown) => void): S3MediaClient {
  return {
    async send(command) {
      onCommand?.(command)
      if (command instanceof GetObjectCommand) {
        return { Body: { async transformToByteArray() { return body } } }
      }
      return {}
    },
  }
}

describe('R2MediaStorage', () => {
  it('constructs the S3 client with the R2 endpoint and exact auto region', async () => {
    const storage = new R2MediaStorage(config)
    const client = (storage as unknown as { client: S3Client }).client
    assert.equal(await client.config.region(), 'auto')
    const endpointProvider = client.config.endpoint
    assert.ok(endpointProvider)
    const endpoint = await endpointProvider()
    assert.equal(endpoint.protocol, 'https:')
    assert.equal(endpoint.hostname, 'account-id.r2.cloudflarestorage.com')
  })

  it('presigns a conditional checksum PUT without AWS-only headers or fields', async () => {
    const calls: Array<{ command: unknown; options: unknown }> = []
    const presign = (async (_client: S3Client, command: unknown, options: unknown) => {
      calls.push({ command, options })
      return 'https://account-id.r2.cloudflarestorage.com/signed-put'
    }) as typeof getSignedUrl
    const storage = new R2MediaStorage(config, bodyClient(new Uint8Array()), presign)
    const result = await storage.issueUpload({
      storageKey, declaredMime: 'image/png', checksumSha256: 'a'.repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
    })

    assert.equal(result.uploadUrl, 'https://account-id.r2.cloudflarestorage.com/signed-put')
    assert.deepEqual(result.uploadHeaders, {
      'content-type': 'image/png', 'if-none-match': '*',
      'x-amz-checksum-sha256': Buffer.from('a'.repeat(64), 'hex').toString('base64'),
    })
    const command = calls[0]?.command as PutObjectCommand
    assert.equal(command.input.ContentType, 'image/png')
    assert.equal(command.input.IfNoneMatch, '*')
    assert.equal(command.input.ChecksumSHA256, Buffer.from('a'.repeat(64), 'hex').toString('base64'))
    assert.equal(command.input.ServerSideEncryption, undefined)
    assert.equal(command.input.Tagging, undefined)
    const options = calls[0]?.options as {
      signableHeaders?: Set<string>
      unhoistableHeaders?: Set<string>
    }
    assert.deepEqual([...options.signableHeaders ?? []].sort(), ['content-type', 'if-none-match'])
    assert.deepEqual([...options.unhoistableHeaders ?? []].sort(), ['x-amz-checksum-sha256'])
  })

  it('inspects an upload without checksum mode and defers when R2 omits provider checksum metadata', async () => {
    let received: HeadObjectCommand | undefined
    const storage = new R2MediaStorage(config, {
      async send(command) {
        if (command instanceof HeadObjectCommand) {
          received = command
          return { ETag: 'fixture-etag', ContentType: 'image/png', ContentLength: 1024 }
        }
        throw new Error('unexpected command')
      },
    })
    const result = await storage.inspectUpload({ storageKey, uploadReceipt: 'fixture-etag' })
    assert.equal(received?.input.ChecksumMode, undefined)
    assert.deepEqual(result, { detectedMime: 'image/png', byteSize: 1024, checksumSha256: null })
  })

  it('downloads, validates, rotates, re-encodes, strips EXIF, writes ready, then deletes quarantine', async () => {
    const source = await sharp({
      create: { width: 16, height: 8, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 1 } },
    }).withMetadata({ orientation: 6 }).png().toBuffer()
    let finalBody: Buffer | null = null
    const commands: string[] = []
    const storage = new R2MediaStorage(config, bodyClient(source, (command) => {
      if (command instanceof GetObjectCommand) commands.push('get')
      if (command instanceof PutObjectCommand) {
        commands.push('put')
        finalBody = command.input.Body as Buffer
        assert.equal(command.input.Key, `public-media/${finalStorageKey}`)
        assert.equal(command.input.ContentType, 'image/png')
        assert.equal(command.input.ServerSideEncryption, undefined)
        assert.equal(command.input.Tagging, undefined)
        assert.ok(command.input.ChecksumSHA256)
      }
      if (command instanceof DeleteObjectCommand) {
        commands.push('delete')
        assert.equal(command.input.Key, `public-media/${storageKey}`)
      }
    }))
    const result = await storage.sanitizeImage(inputFor(source))

    assert.deepEqual(result, {
      finalStorageKey, detectedMime: 'image/png', width: 8, height: 16,
      exifRemoved: true,
    })
    assert.deepEqual(commands, ['get', 'put', 'delete'])
    assert.ok(finalBody)
    const metadata = await sharp(finalBody).metadata()
    assert.equal(metadata.exif, undefined)
    assert.equal(metadata.orientation, undefined)
    assert.equal(metadata.width, 8)
    assert.equal(metadata.height, 16)
  })

  it('does not delete quarantine when writing the ready object fails', async () => {
    const source = await sharp({
      create: { width: 2, height: 2, channels: 3, background: 'red' },
    }).png().toBuffer()
    const commands: string[] = []
    const storage = new R2MediaStorage(config, bodyClient(source, (command) => {
      if (command instanceof GetObjectCommand) commands.push('get')
      if (command instanceof PutObjectCommand) {
        commands.push('put')
        throw new Error('R2 put unavailable')
      }
      if (command instanceof DeleteObjectCommand) commands.push('delete')
    }))
    await assert.rejects(
      storage.sanitizeImage(inputFor(source)),
      (error: unknown) => error instanceof MediaError && error.retryable === true,
    )
    assert.deepEqual(commands, ['get', 'put'])
  })

  it('rejects raw objects that exceed the 5 MiB limit before decoding', async () => {
    const source = Buffer.alloc(5_242_881)
    let decoded = false
    const storage = new R2MediaStorage(config, bodyClient(source, (command) => {
      if (command instanceof PutObjectCommand) decoded = true
    }))
    await assert.rejects(
      storage.sanitizeImage(inputFor(source)),
      (error: unknown) => error instanceof MediaError &&
        error.code === 'MEDIA_BYTE_SIZE_MISMATCH' && error.retryable === false,
    )
    assert.equal(decoded, false)
  })

  it('maps byte size, checksum, MIME, unsupported format, decode, and dimension failures to stable errors', async () => {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: 'red' },
    }).png().toBuffer()
    const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')
    const corrupt = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('bad')])
    const oversized = await sharp({
      create: { width: 12_001, height: 1, channels: 3, background: 'red' },
    }).png().toBuffer()
    const cases = [
      { name: 'byte size', body: png, input: inputFor(png, { byteSize: png.length + 1 }), code: 'MEDIA_BYTE_SIZE_MISMATCH' },
      { name: 'checksum', body: png, input: inputFor(png, { checksumSha256: 'b'.repeat(64) }), code: 'MEDIA_CHECKSUM_MISMATCH' },
      { name: 'MIME', body: png, input: inputFor(png, { declaredMime: 'image/jpeg' }), code: 'MEDIA_MIME_MISMATCH' },
      { name: 'unsupported format', body: gif, input: inputFor(gif), code: 'MEDIA_DECODE_UNSUPPORTED' },
      { name: 'decode', body: corrupt, input: inputFor(corrupt), code: 'MEDIA_DECODE_FAILED' },
      { name: 'dimensions', body: oversized, input: inputFor(oversized), code: 'MEDIA_DIMENSIONS_INVALID' },
    ] as const

    for (const item of cases) {
      const storage = new R2MediaStorage(config, bodyClient(item.body))
      await assert.rejects(
        storage.sanitizeImage(item.input),
        (error: unknown) => error instanceof MediaError &&
          error.code === item.code && error.retryable === false,
        item.name,
      )
    }
  })
})

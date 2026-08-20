import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { GetObjectCommand, GetObjectTaggingCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'

import { AwsS3MediaStorage, type S3MediaClient } from './aws-s3-storage.js'

describe('AwsS3MediaStorage', () => {
  it('decodes and re-encodes a clean image without metadata before marking a final object ready', async () => {
    const source = await sharp({
      create: { width: 16, height: 8, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 1 } },
    }).withMetadata({ orientation: 6 }).png().toBuffer()
    let finalBody: Buffer | null = null
    let finalKey = ''
    const client: S3MediaClient = {
      async send(command) {
        if (command instanceof GetObjectCommand) {
          return { Body: { async transformToByteArray() { return source } } }
        }
        if (command instanceof PutObjectCommand) {
          finalBody = command.input.Body as Buffer
          finalKey = command.input.Key ?? ''
          assert.equal(command.input.Tagging, 'VibeCheckAccess=ready')
          return {}
        }
        throw new Error('unexpected command')
      },
    }
    const storage = new AwsS3MediaStorage({
      region: 'ap-southeast-1', bucket: 'fixture-bucket', objectPrefix: 'public-media/',
    }, client)
    const result = await storage.sanitizeImage({
      storageKey: 'quarantine/92000000-0000-4000-8000-000000000002/92000000-0000-4000-8000-000000000001',
      mediaResourceId: '92000000-0000-4000-8000-000000000001',
      ownerUserId: '92000000-0000-4000-8000-000000000002', declaredMime: 'image/png',
    })
    assert.equal(finalKey, 'public-media/ready/92000000-0000-4000-8000-000000000002/92000000-0000-4000-8000-000000000001')
    assert.deepEqual({ width: result.width, height: result.height }, { width: 8, height: 16 })
    assert.ok(finalBody)
    const metadata = await sharp(finalBody).metadata()
    assert.equal(metadata.exif, undefined)
    assert.equal(metadata.orientation, undefined)
  })

  it('maps GuardDuty tags without exposing provider errors', async () => {
    const client: S3MediaClient = {
      async send(command) {
        assert.ok(command instanceof GetObjectTaggingCommand)
        return { TagSet: [{ Key: 'GuardDutyMalwareScanStatus', Value: 'THREATS_FOUND' }] }
      },
    }
    const storage = new AwsS3MediaStorage({
      region: 'ap-southeast-1', bucket: 'fixture-bucket', objectPrefix: 'public-media/',
    }, client)
    assert.equal(await storage.getScanResult({
      storageKey: 'quarantine/92000000-0000-4000-8000-000000000002/92000000-0000-4000-8000-000000000001',
    }), 'malicious')
  })
})

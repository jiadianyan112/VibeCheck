import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  GetObjectTaggingCommand,
  HeadObjectCommand,
  PutObjectCommand,
  PutObjectTaggingCommand,
} from '@aws-sdk/client-s3'

import {
  AwsS3PrivateMaterialStorage,
  type S3PrivateMaterialClient,
  type S3PrivateMaterialPresigner,
} from './aws-s3-storage.js'

const storageKey = 'verification/54000000-0000-4000-8000-000000000003/56000000-0000-4000-8000-000000000003'
const checksum = 'a'.repeat(64)

describe('AwsS3PrivateMaterialStorage', () => {
  it('signs a single-part quarantined upload and returns every required browser header', async () => {
    const commands: PutObjectCommand[] = []
    let signedHeaders: readonly string[] = []
    let unhoistableHeaders: readonly string[] = []
    const presign: S3PrivateMaterialPresigner = async (candidate, options) => {
      commands.push(candidate)
      signedHeaders = [...options.signableHeaders]
      unhoistableHeaders = [...options.unhoistableHeaders].sort()
      return 'https://private-bucket.s3.ap-southeast-1.amazonaws.com/signed'
    }
    const storage = createStorage({ async send() { throw new Error('unexpected send') } }, presign)
    const projection = await storage.issueUpload({
      storageKey,
      declaredMime: 'application/pdf',
      byteSize: 4,
      checksumSha256: checksum,
      expiresAt: new Date(Date.now()+1_800_000),
    })
    const command = commands[0]
    assert.ok(command)
    assert.equal(command.input.Key, 'identity/verification/54000000-0000-4000-8000-000000000003/56000000-0000-4000-8000-000000000003')
    assert.equal(command.input.ContentLength, undefined)
    assert.equal(command.input.IfNoneMatch, '*')
    assert.equal(command.input.Tagging, 'VibeCheckAccess=quarantined')
    assert.equal(command.input.ChecksumSHA256, Buffer.from(checksum, 'hex').toString('base64'))
    assert.deepEqual([...signedHeaders].sort(), ['content-type', 'if-none-match'])
    assert.deepEqual(unhoistableHeaders, [
      'x-amz-checksum-sha256',
      'x-amz-server-side-encryption',
      'x-amz-tagging',
    ])
    assert.equal(projection.uploadHeaders['x-amz-tagging'], 'VibeCheckAccess=quarantined')
    assert.equal(projection.uploadHeaders['if-none-match'], '*')
  })

  it('verifies ETag, stored SHA-256, MIME and size from HeadObject', async () => {
    const storage = createStorage({
      async send(command) {
        assert.equal(command instanceof HeadObjectCommand, true)
        return {
          ETag: '"receipt-123"',
          ContentType: 'application/pdf',
          ContentLength: 4,
          ChecksumSHA256: Buffer.from(checksum, 'hex').toString('base64'),
        }
      },
    })
    const result = await storage.inspectUpload({ storageKey, uploadReceipt: '"receipt-123"' })
    assert.deepEqual(result, {
      detectedMime: 'application/pdf', byteSize: 4, checksumSha256: checksum,
    })
  })

  it('maps every GuardDuty managed tag to the safe internal result', async () => {
    const mappings = new Map<string | undefined, string>([
      [undefined, 'pending'],
      ['NO_THREATS_FOUND', 'clean'],
      ['THREATS_FOUND', 'malicious'],
      ['UNSUPPORTED', 'unscannable'],
      ['ACCESS_DENIED', 'retryable_failure'],
      ['FAILED', 'retryable_failure'],
    ])
    for (const [tag, expected] of mappings) {
      const storage = createStorage({
        async send(command) {
          assert.equal(command instanceof GetObjectTaggingCommand, true)
          return { TagSet: tag ? [{ Key: 'GuardDutyMalwareScanStatus', Value: tag }] : [] }
        },
      })
      assert.equal(await storage.getScanResult({ storageKey }), expected)
    }
  })

  it('preserves the GuardDuty tag while opening and revoking the application access tag', async () => {
    const writes: PutObjectTaggingCommand[] = []
    const client: S3PrivateMaterialClient = {
      async send(command) {
        if (command instanceof GetObjectTaggingCommand) {
          return { TagSet: [{ Key: 'GuardDutyMalwareScanStatus', Value: 'NO_THREATS_FOUND' }] }
        }
        if (command instanceof PutObjectTaggingCommand) {
          writes.push(command)
          return {}
        }
        throw new Error('unexpected command')
      },
    }
    const storage = createStorage(client)
    await storage.allowReads({ storageKey })
    await storage.denyReads({ storageKey })
    assert.deepEqual(writes[0]?.input.Tagging?.TagSet, [
      { Key: 'GuardDutyMalwareScanStatus', Value: 'NO_THREATS_FOUND' },
      { Key: 'VibeCheckAccess', Value: 'ready' },
    ])
    assert.deepEqual(writes[1]?.input.Tagging?.TagSet, [
      { Key: 'GuardDutyMalwareScanStatus', Value: 'NO_THREATS_FOUND' },
      { Key: 'VibeCheckAccess', Value: 'revoked' },
    ])
  })

  it('refuses to mark application access ready when the authoritative scan tag is absent', async () => {
    const storage = createStorage({
      async send(command) {
        assert.equal(command instanceof GetObjectTaggingCommand, true)
        return { TagSet: [{ Key: 'VibeCheckAccess', Value: 'quarantined' }] }
      },
    })
    await assert.rejects(
      storage.allowReads({ storageKey }),
      /MATERIAL_STORAGE_SCAN_TAG_NOT_CLEAN/,
    )
  })
})

function createStorage(
  client: S3PrivateMaterialClient,
  presign?: S3PrivateMaterialPresigner,
): AwsS3PrivateMaterialStorage {
  return new AwsS3PrivateMaterialStorage({
    region: 'ap-southeast-1',
    bucket: 'vibecheck-private-material-test',
    objectPrefix: 'identity/verification/',
  }, client, presign)
}

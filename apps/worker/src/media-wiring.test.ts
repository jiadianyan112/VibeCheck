import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const workerMain = readFileSync(new URL('./main.ts', import.meta.url), 'utf8')
const sharedMediaStorage = readFileSync(
  new URL('../../../packages/media/src/aws-s3-storage.ts', import.meta.url),
  'utf8',
)

const forbiddenMediaProviderPath =
  /GetObjectTagging|GuardDuty|ServerSideEncryption|Tagging|x-amz-server-side-encryption|x-amz-tagging/

describe('worker media wiring', () => {
  it('constructs worker media storage through the same shared R2 factory', () => {
    assert.ok(/\bcreateMediaStorage\b/.test(workerMain), 'worker main must use createMediaStorage')
    assert.ok(!/\bAwsS3MediaStorage\b/.test(workerMain), 'worker main must not construct AwsS3MediaStorage')
    assert.ok(/mediaConfig\.s3Endpoint/.test(workerMain), 'worker main must pass the R2 endpoint')
    assert.ok(/mediaConfig\.awsRegion/.test(workerMain), 'worker main must pass the R2 region')
    assert.ok(/mediaConfig\.bucket/.test(workerMain), 'worker main must pass the media bucket')
    assert.ok(/mediaConfig\.objectPrefix/.test(workerMain), 'worker main must pass the object prefix')
  })

  it('keeps GuardDuty and provider tagging out of the active worker media path', () => {
    assert.ok(
      !forbiddenMediaProviderPath.test(`${workerMain}\n${sharedMediaStorage}`),
      'active worker media wiring must not retain provider tagging/scanning paths',
    )
  })

  it('preserves the media scan event boundary', () => {
    assert.match(workerMain, /createMediaScanHandler\(/)
    assert.match(workerMain, /handlers\.set\('media_scan_requested'/)
    assert.match(workerMain, /new MediaScanProcessor\(/)
  })
})

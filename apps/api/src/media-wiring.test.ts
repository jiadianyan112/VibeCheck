import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const apiMain = readFileSync(new URL('./main.ts', import.meta.url), 'utf8')
const apiServer = readFileSync(new URL('./server.ts', import.meta.url), 'utf8')
const sharedMediaStorage = readFileSync(
  new URL('../../../packages/media/src/aws-s3-storage.ts', import.meta.url),
  'utf8',
)

const forbiddenMediaProviderPath =
  /GetObjectTagging|GuardDuty|ServerSideEncryption|Tagging|x-amz-server-side-encryption|x-amz-tagging/

describe('API media wiring', () => {
  it('constructs API media storage through the shared R2 factory', () => {
    assert.ok(/\bcreateMediaStorage\b/.test(apiMain), 'API main must use createMediaStorage')
    assert.ok(!/\bAwsS3MediaStorage\b/.test(apiMain), 'API main must not construct AwsS3MediaStorage')
    assert.ok(/mediaConfig\.s3Endpoint/.test(apiMain), 'API main must pass the R2 endpoint')
    assert.ok(/mediaConfig\.awsRegion/.test(apiMain), 'API main must pass the R2 region')
    assert.ok(/mediaConfig\.bucket/.test(apiMain), 'API main must pass the media bucket')
    assert.ok(/mediaConfig\.objectPrefix/.test(apiMain), 'API main must pass the object prefix')
  })

  it('keeps GuardDuty and provider tagging out of the active API media path', () => {
    assert.ok(
      !forbiddenMediaProviderPath.test(`${apiMain}\n${sharedMediaStorage}`),
      'active API media wiring must not retain provider tagging/scanning paths',
    )
  })

  it('preserves the public media route boundary', () => {
    for (const fragment of [
      "const resourceCollection = '/api/v1/media-resources'",
      'const resourceMatch = path.match(/^\\/api\\/v1\\/media-resources\\/([^/]+)$/)',
      'const resourceCompleteMatch = path.match(/^\\/api\\/v1\\/media-resources\\/([^/]+)\\/complete$/)',
      'const resourceContentMatch = path.match(/^\\/api\\/v1\\/media-resources\\/([^/]+)\\/content$/)',
      "const referenceCollection = '/api/v1/media-references'",
      'const referenceMatch = path.match(/^\\/api\\/v1\\/media-references\\/([^/]+)$/)',
      'response.writeHead(302',
    ]) {
      assert.ok(apiServer.includes(fragment), `missing route boundary fragment: ${fragment}`)
    }
  })
})

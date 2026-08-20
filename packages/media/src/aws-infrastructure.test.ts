import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const template = readFileSync(new URL('../../../infra/aws/public-media.yaml', import.meta.url), 'utf8')

describe('public media AWS infrastructure contract', () => {
  it('keeps ingress private, encrypted, versioned and origin constrained', () => {
    assert.match(template, /SSEAlgorithm: AES256/)
    assert.match(template, /BlockPublicPolicy: true/)
    assert.match(template, /RestrictPublicBuckets: true/)
    assert.match(template, /VersioningConfiguration: \{ Status: Enabled \}/)
    assert.match(template, /AllowedMethods: \[PUT\]/)
    assert.match(template, /- if-none-match/)
    assert.match(template, /- x-amz-checksum-sha256/)
  })

  it('scans only quarantine and lets the runtime create a separate sanitized ready object', () => {
    assert.match(template, /Type: AWS::GuardDuty::MalwareProtectionPlan/)
    assert.match(template, /ObjectPrefixes:\s+- !Sub \$\{ObjectPrefix\}quarantine\//)
    assert.match(template, /GuardDutyMalwareScanStatus': NO_THREATS_FOUND/)
    assert.match(template, /AllowRuntimeMediaPipeline/)
    assert.match(template, /s3:DeleteObject/)
    assert.match(template, /ExpireAbandonedQuarantine/)
  })

  it('requires conditional creation for every browser quarantine object', () => {
    assert.match(template, /DenyNonConditionalQuarantineCreation/)
    assert.match(template, /s3:if-none-match': 'true'/)
    assert.match(template, /s3:ObjectCreationOperation': 'true'/)
  })
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const template = readFileSync(
  new URL('../../../infra/aws/private-material.yaml', import.meta.url),
  'utf8',
)

describe('private material AWS infrastructure contract', () => {
  it('keeps the bucket private, encrypted, versioned and browser-upload constrained', () => {
    assert.match(template, /SSEAlgorithm: AES256/)
    assert.match(template, /BlockPublicPolicy: true/)
    assert.match(template, /RestrictPublicBuckets: true/)
    assert.match(template, /VersioningConfiguration:\s+Status: Enabled/)
    assert.match(template, /AllowedMethods: \[PUT\]/)
    assert.match(template, /- if-none-match/)
    assert.match(template, /- x-amz-checksum-sha256/)
    assert.match(template, /- x-amz-tagging/)
    assert.match(template, /ExposedHeaders:\s+- ETag/)
  })

  it('keeps GuardDuty tagging and both read gates mandatory', () => {
    assert.match(template, /Type: AWS::GuardDuty::MalwareProtectionPlan/)
    assert.match(template, /Tagging:\s+Status: ENABLED/)
    assert.match(template, /GuardDutyMalwareScanStatus: NO_THREATS_FOUND/)
    assert.match(template, /VibeCheckAccess: ready/)
    assert.match(template, /DenyReadUnlessGuardDutyClean/)
    assert.match(template, /DenyReadUnlessApplicationReady/)
  })

  it('prevents a presigned upload from overwriting an existing object key', () => {
    assert.match(template, /DenyNonConditionalObjectCreation/)
    assert.match(template, /s3:if-none-match: 'true'/)
    assert.match(template, /s3:ObjectCreationOperation: 'true'/)
  })
})

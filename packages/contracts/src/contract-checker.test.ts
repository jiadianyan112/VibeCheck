import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import { validateContractDocument, validateContractFile } from './contract-checker.js'

describe('OpenAPI contract', () => {
  it('has unique operation IDs and explicit responses', async () => {
    const result = await validateContractFile(resolve('openapi/v1.yaml'))
    assert.deepEqual(result.operationIds, [
      'OP-PLATFORM-LIVE',
      'OP-PLATFORM-READY',
      'OP-AUTH-START',
      'OP-AUTH-CALLBACK',
      'OP-AUTH-SESSION-GET',
      'OP-AUTH-SESSION-DELETE',
      'OP-AUTH-PENDING-CREATE',
      'OP-AUTH-PENDING-GET',
      'OP-AUTH-PENDING-CONSUME',
      'OP-AUTH-PENDING-CANCEL',
      'OP-SEARCH',
      'OP-COMP-GET',
      'OP-COMP-PUT',
      'OP-COMP-SAVE',
      'OP-INTERACT-SET',
      'OP-COMMENT-LIST',
      'OP-COMMENT-CREATE',
      'OP-COMMENT-REPORT',
      'OP-COMMENT-WITHDRAW',
      'OP-AUTH-MERGE-GET',
      'OP-AUTH-MERGE-RESOLVE',
      'OP-AUTH-MERGE-CANCEL',
      'OP-QUERY-GET',
      'OP-QUERY-INVALIDATE',
      'OP-QUERY-LINK',
      'OP-QUERY-UNLINK',
      'OP-PROJ-LIST',
      'OP-PROJ-GET',
      'OP-EVENT-LIST',
      'OP-ASSET-LIST',
      'OP-ASSET-RESOLVE',
      'OP-CREATOR-GET',
    ])
    assert.equal(result.pathCount, 28)
  })

  it('rejects a dangling local schema reference', () => {
    assert.throws(
      () => validateContractDocument({
        openapi: '3.1.0',
        info: {},
        paths: {
          '/broken': {
            get: {
              operationId: 'OP-BROKEN',
              responses: {
                '200': {
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/Missing' },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      /CONTRACT_REF_UNRESOLVED/,
    )
  })
})

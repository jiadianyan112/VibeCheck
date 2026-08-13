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
      'OP-ANALYTICS-INGEST',
      'OP-COMP-GET',
      'OP-COMP-PUT',
      'OP-COMP-SAVE',
      'OP-NOTIFICATION-LIST',
      'OP-NOTIFICATION-READ-SET',
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
      'OP-URL-CHECK',
      'OP-DRAFT-CREATE',
      'OP-DRAFT-GET',
      'OP-DRAFT-PATCH',
      'OP-DRAFT-PREVIEW',
      'OP-SUBMIT',
      'OP-DRAFT-REVISE',
      'OP-SUB-WITHDRAW',
      'OP-UPD-CREATE',
      'OP-UPD-GET',
      'OP-UPD-PATCH',
      'OP-UPD-PREVIEW',
      'OP-UPD-SUBMIT',
      'OP-UPD-WITHDRAW',
      'OP-VER-DRAFT-CREATE',
      'OP-VER-GET',
      'OP-VER-DRAFT-PATCH',
      'OP-VER-MATERIAL-PREPARE',
      'OP-VER-MATERIAL-GET',
      'OP-VER-MATERIAL-COMPLETE',
      'OP-VER-MATERIAL-REVOKE',
      'OP-MEDIA-STATUS',
      'OP-MEDIA-REF-LIST',
      'OP-MEDIA-REF-CREATE',
      'OP-MEDIA-REF-PATCH',
      'OP-MEDIA-REF-DELETE',
      'OP-EVID-DRAFT-CREATE',
      'OP-EVID-DRAFT-GET',
      'OP-EVID-DRAFT-PATCH',
      'OP-EVID-DRAFT-BIND',
      'OP-EVID-DRAFT-COMPLETE',
      'OP-EVID-DRAFT-WITHDRAW',
      'OP-EVID-ATTACH-CREATE',
      'OP-EVID-ATTACH-DELETE',
      'OP-ADMIN-PREVIEW',
      'OP-ADMIN-CONFIRM',
      'OP-WORK-QUEUE',
      'OP-ADMIN-CLAIM',
      'OP-ADMIN-HEARTBEAT',
      'OP-ADMIN-RELEASE',
      'OP-ADMIN-DECISION',
      'OP-PROJ-LIST',
      'OP-PROJ-GET',
      'OP-EVENT-LIST',
      'OP-ASSET-LIST',
      'OP-ASSET-RESOLVE',
      'OP-CREATOR-GET',
    ])
    assert.equal(result.pathCount, 66)
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

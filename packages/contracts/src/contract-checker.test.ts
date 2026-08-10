import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import { validateContractDocument, validateContractFile } from './contract-checker.js'

describe('OpenAPI contract', () => {
  it('has unique operation IDs and explicit responses', async () => {
    const result = await validateContractFile(resolve('openapi/v1.yaml'))
    assert.deepEqual(result.operationIds, ['OP-PLATFORM-LIVE', 'OP-PLATFORM-READY'])
    assert.equal(result.pathCount, 2)
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

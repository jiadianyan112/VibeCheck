import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  AdminProjectImportError,
  normalizeImportedPublicUrl,
  parseAdminProjectImportEnvelope,
} from './admin-importer.js'

describe('admin project importer input', () => {
  it('normalizes a public HTTP URL without performing network access', () => {
    assert.equal(
      normalizeImportedPublicUrl('HTTPS://Example.COM:443/path/?z=2&a=1#section'),
      'https://example.com/path?a=1&z=2',
    )
  })

  it('rejects credentials and non-HTTP schemes', () => {
    for (const value of ['file:///etc/passwd', 'https://user:secret@example.com/']) {
      assert.throws(
        () => normalizeImportedPublicUrl(value),
        (error) => error instanceof AdminProjectImportError && error.code === 'IMPORT_PUBLIC_URL_INVALID',
      )
    }
  })

  it('requires one stable source key per independently receipted item', () => {
    assert.throws(
      () => parseAdminProjectImportEnvelope({
        schema_version: 'admin_project_import.v1',
        batch_key: 'cold-start-001',
        items: [
          { source_record_key: 'same-key' },
          { source_record_key: 'same-key' },
        ],
      }),
      (error) => error instanceof AdminProjectImportError &&
        error.code === 'IMPORT_SOURCE_RECORD_KEY_DUPLICATE',
    )
  })
})

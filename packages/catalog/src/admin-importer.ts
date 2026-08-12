import { createHash } from 'node:crypto'

import type { Pool, PoolClient } from 'pg'

import { CatalogError } from './errors.js'
import { categoryIds, schemaVersions, type CategoryId, type CategorySchemaVersion, type ProjectSnapshot } from './types.js'
import { parseProjectSnapshot } from './validation.js'

type JsonObject = Record<string, unknown>

export class AdminProjectImportError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
  ) {
    super(code)
    this.name = 'AdminProjectImportError'
  }
}

export interface AdminProjectImportEnvelope {
  readonly schemaVersion: 'admin_project_import.v1'
  readonly batchKey: string
  readonly items: readonly Readonly<{
    sourceRecordKey: string
    value: JsonObject
  }>[]
}

export interface AdminProjectImportCommand {
  readonly sourceName: string
  readonly actorUserId: string
  readonly requestId: string
  readonly input: unknown
}

export interface AdminProjectImportItemResult {
  readonly source_record_key: string
  readonly status: 'accepted' | 'rejected'
  readonly admin_creation_draft_id: string | null
  readonly error_code: string | null
  readonly duplicate_candidates: readonly DuplicateCandidate[]
  readonly replayed: boolean
}

export interface AdminProjectImportResult {
  readonly import_batch_id: string
  readonly batch_key: string
  readonly status: 'completed' | 'completed_with_errors'
  readonly item_count: number
  readonly accepted_count: number
  readonly rejected_count: number
  readonly items: readonly AdminProjectImportItemResult[]
}

interface ParsedImportItem {
  readonly sourceRecordKey: string
  readonly requestHash: string
  readonly categoryId: CategoryId
  readonly categorySchemaVersion: CategorySchemaVersion
  readonly reasonCode: string
  readonly snapshot: ProjectSnapshot
  readonly canonicalPublicUrl: string
  readonly canonicalUrlHash: Buffer
}

interface DuplicateCandidate {
  readonly target_type: 'project' | 'admin_project_creation_draft'
  readonly target_id: string
  readonly status: string
}

interface StoredBatch {
  readonly import_batch_id: string
  readonly actor_user_id: string
  readonly input_digest: string
  readonly status: 'running' | 'completed' | 'completed_with_errors'
  readonly item_count: number
}

interface StoredReceipt {
  readonly source_record_key: string
  readonly status: 'accepted' | 'rejected'
  readonly admin_creation_draft_id: string | null
  readonly error_code: string | null
  readonly result_json: {
    readonly duplicate_candidates?: readonly DuplicateCandidate[]
    readonly replayed?: boolean
  }
}

function object(value: unknown, code: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdminProjectImportError(code, 422)
  }
  return value as JsonObject
}

function exact(value: JsonObject, allowed: readonly string[], code: string): void {
  const allowedSet = new Set(allowed)
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw new AdminProjectImportError(code, 422)
  }
}

function importString(
  value: unknown,
  code: string,
  maximum: number,
  pattern?: RegExp,
): string {
  if (typeof value !== 'string') throw new AdminProjectImportError(code, 422)
  const normalized = value.trim()
  if (normalized.length < 1 || normalized.length > maximum || (pattern && !pattern.test(normalized))) {
    throw new AdminProjectImportError(code, 422)
  }
  return normalized
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const record = value as JsonObject
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function normalizeImportedPublicUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new AdminProjectImportError('IMPORT_PUBLIC_URL_INVALID', 422)
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new AdminProjectImportError('IMPORT_PUBLIC_URL_INVALID', 422)
  }
  url.hash = ''
  url.searchParams.sort()
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  const normalized = `${url.origin}${url.pathname === '/' ? '' : url.pathname}${url.search}`
  if (normalized.length > 2_048) throw new AdminProjectImportError('IMPORT_PUBLIC_URL_INVALID', 422)
  return normalized
}

export function parseAdminProjectImportEnvelope(value: unknown): AdminProjectImportEnvelope {
  const record = object(value, 'IMPORT_ENVELOPE_INVALID')
  exact(record, ['schema_version', 'batch_key', 'items'], 'IMPORT_ENVELOPE_INVALID')
  if (record.schema_version !== 'admin_project_import.v1') {
    throw new AdminProjectImportError('IMPORT_SCHEMA_VERSION_UNSUPPORTED', 422)
  }
  const batchKey = importString(record.batch_key, 'IMPORT_BATCH_KEY_INVALID', 128, /^[A-Za-z0-9._:-]+$/)
  if (!Array.isArray(record.items) || record.items.length < 1 || record.items.length > 500) {
    throw new AdminProjectImportError('IMPORT_ITEM_COUNT_INVALID', 422)
  }
  const seen = new Set<string>()
  const items = record.items.map((raw) => {
    const item = object(raw, 'IMPORT_ITEM_INVALID')
    const sourceRecordKey = importString(
      item.source_record_key,
      'IMPORT_SOURCE_RECORD_KEY_INVALID',
      128,
      /^[A-Za-z0-9._:-]+$/,
    )
    if (seen.has(sourceRecordKey)) throw new AdminProjectImportError('IMPORT_SOURCE_RECORD_KEY_DUPLICATE', 422)
    seen.add(sourceRecordKey)
    return Object.freeze({ sourceRecordKey, value: item })
  })
  return Object.freeze({
    schemaVersion: 'admin_project_import.v1',
    batchKey,
    items: Object.freeze(items),
  })
}

function parseItem(sourceRecordKey: string, value: JsonObject): ParsedImportItem {
  exact(value, [
    'source_record_key', 'category_id', 'category_schema_version', 'reason_code', 'initial_snapshot',
  ], 'IMPORT_ITEM_FIELD_UNKNOWN')
  const categoryId = importString(value.category_id, 'IMPORT_CATEGORY_INVALID', 64) as CategoryId
  const schemaVersion = importString(
    value.category_schema_version,
    'IMPORT_CATEGORY_SCHEMA_INVALID',
    32,
  ) as CategorySchemaVersion
  if (!categoryIds.includes(categoryId) || !schemaVersions.includes(schemaVersion)) {
    throw new AdminProjectImportError('IMPORT_CATEGORY_SCHEMA_INVALID', 422)
  }
  if (
    (categoryId === 'ai_learning_quiz' && schemaVersion !== 'learning.v1') ||
    (categoryId === 'personal_site_portfolio' && schemaVersion !== 'portfolio.v1')
  ) throw new AdminProjectImportError('IMPORT_CATEGORY_SCHEMA_MISMATCH', 422)
  const reasonCode = importString(value.reason_code, 'IMPORT_REASON_CODE_INVALID', 64, /^[A-Z][A-Z0-9_]*$/)
  let parsed: ProjectSnapshot
  try {
    parsed = parseProjectSnapshot(value.initial_snapshot, categoryId, schemaVersion)
  } catch (error) {
    if (error instanceof CatalogError && error.code === 'CATALOG_SCHEMA_MISMATCH') {
      throw new AdminProjectImportError('IMPORT_CATEGORY_SCHEMA_MISMATCH', 422)
    }
    throw new AdminProjectImportError('IMPORT_SNAPSHOT_INVALID', 422)
  }
  const canonicalPublicUrl = normalizeImportedPublicUrl(parsed.project_core.public_url)
  const normalizedSnapshot = parseProjectSnapshot({
    ...parsed,
    project_core: { ...parsed.project_core, public_url: canonicalPublicUrl },
  }, categoryId, schemaVersion)
  return Object.freeze({
    sourceRecordKey,
    requestHash: sha256(stableJson(value)),
    categoryId,
    categorySchemaVersion: schemaVersion,
    reasonCode,
    snapshot: normalizedSnapshot,
    canonicalPublicUrl,
    canonicalUrlHash: createHash('sha256').update(canonicalPublicUrl, 'utf8').digest(),
  })
}

function itemResult(row: StoredReceipt): AdminProjectImportItemResult {
  return Object.freeze({
    source_record_key: row.source_record_key,
    status: row.status,
    admin_creation_draft_id: row.admin_creation_draft_id,
    error_code: row.error_code,
    duplicate_candidates: Object.freeze([...(row.result_json.duplicate_candidates ?? [])]),
    replayed: row.result_json.replayed ?? false,
  })
}

async function actorRoles(client: PoolClient, actorUserId: string): Promise<readonly string[]> {
  const result = await client.query<{ status: string; roles: string[] }>(
    `SELECT account.status,
       COALESCE(array_agg(role.role ORDER BY role.role)
         FILTER (WHERE role.role IS NOT NULL), ARRAY[]::varchar[]) AS roles
     FROM iam.users account
     LEFT JOIN iam.user_roles role ON role.user_id=account.user_id
       AND role.valid_from <= now()
       AND (role.valid_to IS NULL OR role.valid_to > now())
     WHERE account.user_id=$1
     GROUP BY account.user_id,account.status`,
    [actorUserId],
  )
  const row = result.rows[0]
  if (!row || row.status !== 'active' || !row.roles.some((role) => role === 'editor' || role === 'admin')) {
    throw new AdminProjectImportError('IMPORT_ACTOR_FORBIDDEN', 403)
  }
  return Object.freeze(row.roles)
}

export class PostgresAdminProjectImporter {
  constructor(private readonly pool: Pool) {}

  async import(command: AdminProjectImportCommand): Promise<AdminProjectImportResult> {
    const sourceName = importString(command.sourceName, 'IMPORT_SOURCE_INVALID', 64, /^[A-Za-z0-9._:-]+$/)
    const actorUserId = importString(
      command.actorUserId,
      'IMPORT_ACTOR_INVALID',
      36,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    ).toLowerCase()
    const requestId = importString(command.requestId, 'IMPORT_REQUEST_ID_INVALID', 64, /^[A-Za-z0-9_-]+$/)
    const envelope = parseAdminProjectImportEnvelope(command.input)
    const inputDigest = sha256(stableJson(command.input))
    const batch = await this.ensureBatch(
      sourceName,
      envelope.batchKey,
      actorUserId,
      inputDigest,
      envelope.items.length,
      requestId,
    )

    if (batch.status !== 'running') return this.loadResult(batch.import_batch_id, envelope.batchKey)

    for (const raw of envelope.items) {
      const requestHash = sha256(stableJson(raw.value))
      let parsed: ParsedImportItem
      try {
        parsed = parseItem(raw.sourceRecordKey, raw.value)
      } catch (error) {
        const importError = error instanceof AdminProjectImportError
          ? error
          : new AdminProjectImportError('IMPORT_ITEM_INVALID', 422)
        await this.rejectItem(
          batch.import_batch_id,
          sourceName,
          actorUserId,
          requestId,
          raw.sourceRecordKey,
          requestHash,
          importError.code,
        )
        continue
      }
      await this.acceptOrReplayItem(batch.import_batch_id, sourceName, actorUserId, requestId, parsed)
    }

    await this.finalizeBatch(batch.import_batch_id)
    return this.loadResult(batch.import_batch_id, envelope.batchKey)
  }

  private async ensureBatch(
    sourceName: string,
    batchKey: string,
    actorUserId: string,
    inputDigest: string,
    itemCount: number,
    requestId: string,
  ): Promise<StoredBatch> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await actorRoles(client, actorUserId)
      await client.query(
        `INSERT INTO workflow.admin_project_import_batches (
           source_name,batch_key,actor_user_id,input_digest,item_count,request_id
         ) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (source_name,batch_key) DO NOTHING`,
        [sourceName, batchKey, actorUserId, inputDigest, itemCount, requestId],
      )
      const selected = await client.query<StoredBatch>(
        `SELECT import_batch_id,actor_user_id,input_digest,status,item_count
         FROM workflow.admin_project_import_batches
         WHERE source_name=$1 AND batch_key=$2
         FOR UPDATE`,
        [sourceName, batchKey],
      )
      const batch = selected.rows[0]!
      if (
        batch.actor_user_id !== actorUserId || batch.input_digest !== inputDigest ||
        batch.item_count !== itemCount
      ) throw new AdminProjectImportError('IMPORT_BATCH_KEY_CONFLICT', 409)
      await client.query('COMMIT')
      return batch
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async existingBatchReceipt(
    client: PoolClient,
    batchId: string,
    sourceRecordKey: string,
    requestHash: string,
  ): Promise<StoredReceipt | null> {
    const existing = await client.query<StoredReceipt & { request_hash: string }>(
      `SELECT source_record_key,status,admin_creation_draft_id,error_code,result_json,request_hash
       FROM workflow.admin_project_import_receipts
       WHERE import_batch_id=$1 AND source_record_key=$2`,
      [batchId, sourceRecordKey],
    )
    const receipt = existing.rows[0]
    if (!receipt) return null
    if (receipt.request_hash !== requestHash) {
      throw new AdminProjectImportError('IMPORT_ITEM_KEY_CONFLICT', 409)
    }
    return receipt
  }

  private async acceptOrReplayItem(
    batchId: string,
    sourceName: string,
    actorUserId: string,
    requestId: string,
    item: ParsedImportItem,
  ): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const roles = await actorRoles(client, actorUserId)
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `${sourceName}:${item.sourceRecordKey}`,
      ])
      if (await this.existingBatchReceipt(client, batchId, item.sourceRecordKey, item.requestHash)) {
        await client.query('COMMIT')
        return
      }
      const priorDraft = await client.query<{
        admin_creation_draft_id: string
        import_request_hash: string
        duplicate_candidates_json: readonly DuplicateCandidate[]
      }>(
        `SELECT admin_creation_draft_id,import_request_hash,duplicate_candidates_json
         FROM workflow.admin_project_creation_drafts
         WHERE import_source=$1 AND source_record_key=$2`,
        [sourceName, item.sourceRecordKey],
      )
      if (priorDraft.rows[0]) {
        const prior = priorDraft.rows[0]
        if (prior.import_request_hash === item.requestHash) {
          await client.query(
            `INSERT INTO workflow.admin_project_import_receipts (
               import_batch_id,source_name,source_record_key,request_hash,status,
               admin_creation_draft_id,result_json
             ) VALUES ($1,$2,$3,$4,'accepted',$5,$6)`,
            [batchId, sourceName, item.sourceRecordKey, item.requestHash, prior.admin_creation_draft_id, {
              duplicate_candidates: prior.duplicate_candidates_json,
              replayed: true,
            }],
          )
        } else {
          await this.insertRejectedReceipt(
            client, batchId, sourceName, actorUserId, roles, requestId,
            item.sourceRecordKey, item.requestHash, 'IMPORT_ITEM_KEY_CONFLICT',
          )
        }
        await client.query('COMMIT')
        return
      }

      const candidates = await this.duplicateCandidates(client, item.canonicalUrlHash)
      const draft = await client.query<{ admin_creation_draft_id: string }>(
        `INSERT INTO workflow.admin_project_creation_drafts (
           owner_editor_id,category_id,category_schema_version,snapshot_json,
           canonical_public_url,canonical_url_hash,duplicate_candidates_json,reason_code,
           source_kind,import_source,source_record_key,import_request_hash
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'catalog_import',$9,$10,$11)
         RETURNING admin_creation_draft_id`,
        [
          actorUserId, item.categoryId, item.categorySchemaVersion, item.snapshot,
          item.canonicalPublicUrl, item.canonicalUrlHash, candidates, item.reasonCode,
          sourceName, item.sourceRecordKey, item.requestHash,
        ],
      )
      const draftId = draft.rows[0]!.admin_creation_draft_id
      const receipt = await client.query<{ import_item_id: string }>(
        `INSERT INTO workflow.admin_project_import_receipts (
           import_batch_id,source_name,source_record_key,request_hash,status,
           admin_creation_draft_id,result_json
         ) VALUES ($1,$2,$3,$4,'accepted',$5,$6)
         RETURNING import_item_id`,
        [batchId, sourceName, item.sourceRecordKey, item.requestHash, draftId, {
          duplicate_candidates: candidates,
          replayed: false,
        }],
      )
      await client.query(
        `INSERT INTO audit.audit_logs (
           operation_id,actor_type,actor_id_hash,actor_roles_json,target_type,target_id,
           after_hash,diff_json,reason_code,request_id,result
         ) VALUES ($1,'platform_editor',digest($2::text,'sha256'),$3,
           'admin_project_creation_draft',$4,$5,$6,$7,$8,'accepted')`,
        [
          `admin-import-${receipt.rows[0]!.import_item_id}`,
          actorUserId,
          roles,
          draftId,
          item.requestHash,
          {
            category_id: item.categoryId,
            category_schema_version: item.categorySchemaVersion,
            duplicate_candidate_count: candidates.length,
            import_source: sourceName,
          },
          item.reasonCode,
          requestId,
        ],
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async duplicateCandidates(
    client: PoolClient,
    canonicalUrlHash: Buffer,
  ): Promise<readonly DuplicateCandidate[]> {
    const result = await client.query<DuplicateCandidate>(
      `SELECT 'project'::text AS target_type,project_id::text AS target_id,review_status AS status
       FROM catalog.projects
       WHERE canonical_url_hash=$1 AND review_status <> 'deleted'
       UNION ALL
       SELECT 'admin_project_creation_draft'::text AS target_type,
         admin_creation_draft_id::text AS target_id,status
       FROM workflow.admin_project_creation_drafts
       WHERE canonical_url_hash=$1 AND status IN ('editing','submitted')
       ORDER BY target_type,target_id`,
      [canonicalUrlHash],
    )
    return Object.freeze(result.rows.map((row) => Object.freeze(row)))
  }

  private async rejectItem(
    batchId: string,
    sourceName: string,
    actorUserId: string,
    requestId: string,
    sourceRecordKey: string,
    requestHash: string,
    errorCode: string,
  ): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const roles = await actorRoles(client, actorUserId)
      const existing = await this.existingBatchReceipt(client, batchId, sourceRecordKey, requestHash)
      if (!existing) {
        await this.insertRejectedReceipt(
          client, batchId, sourceName, actorUserId, roles, requestId,
          sourceRecordKey, requestHash, errorCode,
        )
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async insertRejectedReceipt(
    client: PoolClient,
    batchId: string,
    sourceName: string,
    actorUserId: string,
    roles: readonly string[],
    requestId: string,
    sourceRecordKey: string,
    requestHash: string,
    errorCode: string,
  ): Promise<void> {
    const receipt = await client.query<{ import_item_id: string }>(
      `INSERT INTO workflow.admin_project_import_receipts (
         import_batch_id,source_name,source_record_key,request_hash,status,error_code,result_json
       ) VALUES ($1,$2,$3,$4,'rejected',$5,$6)
       RETURNING import_item_id`,
      [batchId, sourceName, sourceRecordKey, requestHash, errorCode, {
        duplicate_candidates: [],
        replayed: false,
      }],
    )
    await client.query(
      `INSERT INTO audit.audit_logs (
         operation_id,actor_type,actor_id_hash,actor_roles_json,target_type,target_id,
         after_hash,diff_json,reason_code,request_id,result
       ) VALUES ($1,'platform_editor',digest($2::text,'sha256'),$3,
         'admin_project_import_item',$4,$5,$6,'IMPORT_VALIDATION_REJECTED',$7,'rejected')`,
      [
        `admin-import-${receipt.rows[0]!.import_item_id}`,
        actorUserId,
        roles,
        receipt.rows[0]!.import_item_id,
        requestHash,
        { error_code: errorCode, import_source: sourceName },
        requestId,
      ],
    )
  }

  private async finalizeBatch(batchId: string): Promise<void> {
    await this.pool.query(
      `WITH totals AS (
         SELECT count(*)::int AS processed,
           count(*) FILTER (WHERE status='accepted')::int AS accepted,
           count(*) FILTER (WHERE status='rejected')::int AS rejected
         FROM workflow.admin_project_import_receipts
         WHERE import_batch_id=$1
       )
       UPDATE workflow.admin_project_import_batches batch
       SET accepted_count=totals.accepted,
           rejected_count=totals.rejected,
           status=CASE WHEN totals.rejected=0 THEN 'completed' ELSE 'completed_with_errors' END,
           completed_at=now()
       FROM totals
       WHERE batch.import_batch_id=$1 AND batch.status='running'
         AND totals.processed=batch.item_count`,
      [batchId],
    )
  }

  private async loadResult(batchId: string, batchKey: string): Promise<AdminProjectImportResult> {
    const batch = await this.pool.query<{
      status: 'running' | 'completed' | 'completed_with_errors'
      item_count: number
      accepted_count: number
      rejected_count: number
    }>(
      `SELECT status,item_count,accepted_count,rejected_count
       FROM workflow.admin_project_import_batches WHERE import_batch_id=$1`,
      [batchId],
    )
    const current = batch.rows[0]!
    if (current.status === 'running') throw new AdminProjectImportError('IMPORT_BATCH_INCOMPLETE', 503)
    const receipts = await this.pool.query<StoredReceipt>(
      `SELECT source_record_key,status,admin_creation_draft_id,error_code,result_json
       FROM workflow.admin_project_import_receipts
       WHERE import_batch_id=$1
       ORDER BY created_at,import_item_id`,
      [batchId],
    )
    return Object.freeze({
      import_batch_id: batchId,
      batch_key: batchKey,
      status: current.status,
      item_count: current.item_count,
      accepted_count: current.accepted_count,
      rejected_count: current.rejected_count,
      items: Object.freeze(receipts.rows.map(itemResult)),
    })
  }
}

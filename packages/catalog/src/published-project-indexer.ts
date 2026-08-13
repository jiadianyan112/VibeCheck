import type { Pool, QueryResultRow } from 'pg'

import { buildSearchDocument } from './search-document.js'
import type { CategoryId, CategorySchemaVersion } from './types.js'
import { parseProjectSnapshot } from './validation.js'

export interface PublishedProjectIndexProjection {
  readonly project_id: string
  readonly version_id: string
  readonly category_id: CategoryId
  readonly indexed_at: string
  readonly index_status: 'indexed' | 'already_current' | 'already_newer'
}

interface SourceRow extends QueryResultRow {
  readonly project_id: string
  readonly version_id: string
  readonly category_id: CategoryId
  readonly category_schema_version: CategorySchemaVersion
  readonly snapshot_json: unknown
  readonly version_number: number
}

interface IndexRow extends QueryResultRow {
  readonly project_id: string
  readonly version_id: string
  readonly category_id: CategoryId
  readonly indexed_at: Date
}

function indexError(code: string): Error {
  return new Error(code)
}

export class PostgresPublishedProjectIndexer {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async indexPublishedProject(input: Readonly<{
    projectId: string
    versionId: string
    submissionId: string
    reviewDecisionId: string
  }>): Promise<PublishedProjectIndexProjection> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const sourceResult = await client.query<SourceRow>(
        `SELECT project.project_id,version.version_id,version.category_id,
           version.category_schema_version,version.snapshot_json,version.version_number
         FROM workflow.submission_publication_receipts receipt
         JOIN workflow.submissions submission ON submission.submission_id=receipt.submission_id
         JOIN catalog.projects project ON project.project_id=receipt.project_id
         JOIN catalog.project_versions receipt_version ON receipt_version.version_id=receipt.version_id
         JOIN catalog.project_versions version ON version.version_id=project.current_version_id
         JOIN workflow.review_decisions decision
           ON decision.review_decision_id=receipt.review_decision_id
         WHERE receipt.project_id=$1 AND receipt.version_id=$2 AND receipt.submission_id=$3
           AND receipt.review_decision_id=$4 AND submission.review_status='published'
           AND submission.resulting_project_id=project.project_id
           AND receipt_version.version_id=$2 AND receipt_version.project_id=project.project_id
           AND project.review_status IN ('published_platform','published_author')
           AND decision.decision='approve' AND decision.target_id=submission.submission_id
         FOR SHARE OF receipt,submission,project,version,decision`,
        [input.projectId, input.versionId, input.submissionId, input.reviewDecisionId],
      )
      const source = sourceResult.rows[0]
      if (!source) throw indexError('PROJECT_PUBLISHED_PROJECTION_SOURCE_INVALID')

      const snapshot = parseProjectSnapshot(
        source.snapshot_json, source.category_id, source.category_schema_version,
      )
      const document = buildSearchDocument(snapshot)
      const indexedAt = this.now()
      const upsert = await client.query<IndexRow>(
        `INSERT INTO search.project_documents (
           project_id,version_id,category_id,visibility,structured_json,search_text,
           ranking_features_json,indexed_at
         ) VALUES ($1,$2,$3,'public',$4::jsonb,$5,$6::jsonb,$7)
         ON CONFLICT (project_id) DO UPDATE SET
           version_id=EXCLUDED.version_id,
           category_id=EXCLUDED.category_id,
           visibility=EXCLUDED.visibility,
           structured_json=EXCLUDED.structured_json,
           search_text=EXCLUDED.search_text,
           ranking_features_json=EXCLUDED.ranking_features_json,
           indexed_at=EXCLUDED.indexed_at
         WHERE (
           SELECT existing_version.version_number
           FROM catalog.project_versions existing_version
           WHERE existing_version.version_id=search.project_documents.version_id
         ) < $8
         RETURNING project_id,version_id,category_id,indexed_at`,
        [source.project_id, source.version_id, source.category_id,
          JSON.stringify(document.structured), document.searchText,
          JSON.stringify(document.rankingFeatures), indexedAt, source.version_number],
      )
      await client.query(
        `INSERT INTO catalog.project_interaction_counters (
           project_id,recalculated_at,source_watermark
         ) VALUES ($1,$2,$3)
         ON CONFLICT (project_id) DO NOTHING`,
        [source.project_id, indexedAt, `project_version:${source.version_id}`],
      )

      let row = upsert.rows[0]
      let status: PublishedProjectIndexProjection['index_status'] = 'indexed'
      if (!row) {
        const current = await client.query<IndexRow & { readonly version_number: number }>(
          `SELECT document.project_id,document.version_id,document.category_id,document.indexed_at,
             version.version_number
           FROM search.project_documents document
           JOIN catalog.project_versions version ON version.version_id=document.version_id
           WHERE document.project_id=$1`,
          [source.project_id],
        )
        row = current.rows[0]
        status = current.rows[0]?.version_number === source.version_number
          ? 'already_current'
          : 'already_newer'
      }
      if (!row) throw indexError('PROJECT_PUBLISHED_PROJECTION_WRITE_FAILED')
      await client.query('COMMIT')
      return Object.freeze({
        project_id: row.project_id,
        version_id: row.version_id,
        category_id: row.category_id,
        indexed_at: row.indexed_at.toISOString(),
        index_status: status,
      })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }
}

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Pool } from 'pg'
import { CatalogError, catalogError } from './errors.js'
import type { CatalogService } from './service.js'
import type { PostgresAuthorAuthorizationResolver } from './author-authorization.js'
import type { DeveloperProjection } from './types.js'

export interface MyDeveloperProject {
  readonly project_id: string
  readonly current_name: string
  readonly developer: DeveloperProjection | null
  readonly verification_id: string | null
  readonly verification_status: 'draft' | 'pending' | 'changes_requested' | 'verified' | 'failed' | 'withdrawn' | null
  readonly can_manage: boolean
}
export interface MyDeveloperProjectsPage { readonly items: readonly MyDeveloperProject[]; readonly next_cursor: string | null }
interface ProjectRow { project_id: string; current_name: string; updated_at: Date; review_status: string; verification_id: string | null; verification_status: MyDeveloperProject['verification_status'] }
interface Cursor { user_id: string; project_id: string | null; after_at: string; after_id: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class DeveloperAccountService {
  constructor(private readonly dependencies: Readonly<{ pool: Pool; catalog: CatalogService; authorization: PostgresAuthorAuthorizationResolver; cursorSecret: string }>) {
    if (dependencies.cursorSecret.length < 32) throw new Error('CATALOG_CURSOR_SECRET_INVALID')
  }
  async list(input: Readonly<{ userId: string; limit: number; cursor: string | null; projectId: string | null }>): Promise<MyDeveloperProjectsPage> {
    if (!uuid.test(input.userId) || (input.projectId !== null && !uuid.test(input.projectId))) throw catalogError('PROJECT_ID_INVALID', 422)
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) throw catalogError('LIMIT_INVALID', 400)
    const projectId = input.projectId?.toLowerCase() ?? null
    const cursor = input.cursor ? this.decode(input.cursor, input.userId, projectId) : null
    const result = await this.dependencies.pool.query<ProjectRow>(`SELECT project.project_id,project.current_name,project.updated_at,project.review_status,
      latest.verification_id,latest.status AS verification_status
      FROM catalog.projects project
      LEFT JOIN LATERAL (SELECT verification_id,status FROM workflow.verification_requests
        WHERE project_id=project.project_id AND applicant_user_id=$1 ORDER BY created_at DESC,verification_id DESC LIMIT 1) latest ON true
      WHERE project.review_status IN ('published_platform','published_author') AND (
        EXISTS(SELECT 1 FROM workflow.submissions submission WHERE submission.owner_user_id=$1 AND submission.resulting_project_id=project.project_id AND submission.review_status='published')
        OR latest.verification_id IS NOT NULL
        OR EXISTS(SELECT 1 FROM catalog.author_relations relation JOIN catalog.creator_account_links link ON link.creator_id=relation.creator_id
          WHERE relation.project_id=project.project_id AND link.user_id=$1 AND link.status IN ('active','suspended') AND relation.status IN ('active','suspended'))
      ) AND ($2::uuid IS NULL OR project.project_id=$2)
      AND ($3::timestamptz IS NULL OR (project.updated_at,project.project_id)<($3::timestamptz,$4::uuid))
      ORDER BY project.updated_at DESC,project.project_id DESC LIMIT $5`, [input.userId,projectId,cursor?.after_at ?? null,cursor?.after_id ?? null,input.limit+1])
    const rows = result.rows.slice(0, input.limit)
    const items: MyDeveloperProject[] = []
    for (const row of rows) {
      try {
        const project = await this.dependencies.catalog.getProject(row.project_id)
        const authorization = await this.dependencies.authorization.resolveProjectAuthorization({ userId: input.userId, projectId: row.project_id })
        const canManage = row.review_status === 'published_author' && authorization.grants.some(grant => grant.capabilities.includes('project_update.create'))
        items.push(Object.freeze({ project_id: row.project_id,current_name: row.current_name,developer: project.developer,verification_id: row.verification_id,verification_status: row.verification_status,can_manage: canManage }))
      } catch (error) {
        if (!(error instanceof CatalogError) || ![403,404,410].includes(error.httpStatus)) throw error
      }
    }
    const last = rows.at(-1)
    const next = result.rows.length > input.limit && last ? this.encode({ user_id: input.userId, project_id: projectId, after_at: last.updated_at.toISOString(), after_id: last.project_id }) : null
    return Object.freeze({ items: Object.freeze(items), next_cursor: next })
  }
  private encode(cursor: Cursor): string {
    const payload = Buffer.from(JSON.stringify(cursor)).toString('base64url')
    return `${payload}.${this.signature(payload).toString('base64url')}`
  }
  private signature(payload: string): Buffer { return createHmac('sha256', this.dependencies.cursorSecret).update(`developer-projects.v1:${payload}`).digest() }
  private decode(token: string, userId: string, projectId: string | null): Cursor {
    try {
      const parts = token.split('.')
      if (parts.length !== 2 || token.length > 2048) throw new Error()
      const supplied = Buffer.from(parts[1]!, 'base64url')
      const expected = this.signature(parts[0]!)
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error()
      const cursor = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString()) as Cursor
      if (cursor.user_id !== userId || cursor.project_id !== projectId || !uuid.test(cursor.after_id) || !Number.isFinite(Date.parse(cursor.after_at))) throw new Error()
      return cursor
    } catch { throw catalogError('CURSOR_INVALID', 400) }
  }
}

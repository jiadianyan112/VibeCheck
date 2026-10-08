import type { PoolClient } from 'pg'
import { workflowError } from './errors.js'

/** Called inside the approval transaction, after locking the project row. */
export async function guardDeveloperApproval(client: PoolClient, input: Readonly<{ projectId: string; linkRole: string; authorRole: string; declaredKind?: string | null; profileKind?: string | null }>): Promise<void> {
  if (input.linkRole !== 'owner' || input.authorRole !== 'owner') throw workflowError('VERIFICATION_OWNER_REQUIRED', 422)
  if (input.profileKind !== 'individual' && input.profileKind !== 'team') throw workflowError('NEW_CREATOR_PROFILE_INVALID', 422)
  if (input.declaredKind && input.profileKind && input.declaredKind !== input.profileKind) throw workflowError('VERIFICATION_KIND_MISMATCH', 422)
  const result = await client.query<{ claimed: boolean }>(`SELECT EXISTS (
    SELECT 1 FROM catalog.projects WHERE project_id=$1 AND primary_developer_relation_id IS NOT NULL
    UNION ALL
    SELECT 1 FROM catalog.author_relations WHERE project_id=$1 AND author_role='owner' AND status IN ('active','suspended')
  ) AS claimed`, [input.projectId])
  if (result.rows[0]?.claimed) throw workflowError('PROJECT_DEVELOPER_ALREADY_CLAIMED', 409)
}

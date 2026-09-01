import type { Pool, QueryResultRow } from 'pg'

import { catalogError } from './errors.js'
import {
  linkPermissionProfiles,
  type LinkPermissionCapability,
  type LinkPermissionProfileId,
} from './link-permission-profile.js'

export interface ProjectAuthorGrant {
  readonly creator_account_link_id: string
  readonly creator_id: string
  readonly author_relation_id: string
  readonly link_role: 'owner' | 'manager'
  readonly permission_profile_id: LinkPermissionProfileId
  readonly permission_profile_version: 1
  readonly permission_profile_config_hash: string
  readonly author_role: string
  readonly capabilities: readonly LinkPermissionCapability[]
  readonly field_paths: readonly string[]
  readonly link_version: number
  readonly author_relation_version: number
}

export interface ProjectAuthorAuthorization {
  readonly user_id: string
  readonly project_id: string
  readonly grants: readonly ProjectAuthorGrant[]
}

interface StoredAuthorizationRow extends QueryResultRow {
  readonly creator_account_link_id: string
  readonly creator_id: string
  readonly author_relation_id: string
  readonly link_role: string
  readonly permission_profile_id: string
  readonly permission_profile_version: number
  readonly permission_profile_config_hash: string
  readonly author_role: string
  readonly capabilities_json: unknown
  readonly field_path_ceiling_json: unknown
  readonly field_permissions_json: unknown
  readonly link_version: string
  readonly author_relation_version: string
}

export class PostgresAuthorAuthorizationResolver {
  constructor(private readonly pool: Pool) {}

  async resolveProjectAuthorization(input: Readonly<{
    userId: string
    projectId: string
  }>): Promise<ProjectAuthorAuthorization> {
    const result = await this.pool.query<StoredAuthorizationRow>(
      `SELECT link.creator_account_link_id,link.creator_id,relation.author_relation_id,
         link.link_role,link.permission_profile_id,link.permission_profile_version,
         link.permission_profile_config_hash,relation.author_role,
         profile.capabilities_json,profile.field_path_ceiling_json,
         relation.field_permissions_json,link.version AS link_version,
         relation.version AS author_relation_version
       FROM catalog.creator_account_links link
       JOIN catalog.creators creator
         ON creator.creator_id=link.creator_id AND creator.canonical_creator_id IS NULL
       JOIN catalog.link_permission_profiles profile
         ON profile.profile_id=link.permission_profile_id
        AND profile.profile_version=link.permission_profile_version
        AND profile.config_hash=link.permission_profile_config_hash
       JOIN catalog.author_relations relation
         ON relation.creator_id=creator.creator_id
        AND relation.project_id=$2
        AND relation.status='active'
       WHERE link.user_id=$1 AND link.status='active'
       ORDER BY link.creator_account_link_id,relation.author_relation_id`,
      [input.userId, input.projectId],
    )
    return {
      user_id: input.userId,
      project_id: input.projectId,
      grants: result.rows.map(parseGrant),
    }
  }

  async requireCapability(input: Readonly<{
    userId: string
    projectId: string
    capability: LinkPermissionCapability
    fieldPaths?: readonly string[]
  }>): Promise<ProjectAuthorAuthorization> {
    const authorization = await this.resolveProjectAuthorization(input)
    const requestedFields = normalizedUnique(input.fieldPaths ?? [])
    const allowed = authorization.grants.some((grant) => (
      grant.capabilities.includes(input.capability) &&
      requestedFields.every((fieldPath) => grant.field_paths.includes(fieldPath))
    ))
    if (!allowed) throw catalogError('AUTHOR_CAPABILITY_FORBIDDEN', 403, false)
    return authorization
  }
}

function parseGrant(row: StoredAuthorizationRow): ProjectAuthorGrant {
  const expected = linkPermissionProfiles[row.permission_profile_id as LinkPermissionProfileId]
  if (
    !expected ||
    row.permission_profile_version !== 1 ||
    row.permission_profile_config_hash !== expected.config_hash ||
    row.link_role !== expected.profile_family
  ) invalid()
  const capabilities = stringArray(row.capabilities_json)
  const ceiling = stringArray(row.field_path_ceiling_json)
  const relationFields = stringArray(row.field_permissions_json)
  if (!sameSet(capabilities, expected.capabilities) || !sameSet(ceiling, expected.field_path_ceiling)) {
    invalid()
  }
  return Object.freeze({
    creator_account_link_id: row.creator_account_link_id,
    creator_id: row.creator_id,
    author_relation_id: row.author_relation_id,
    link_role: row.link_role as 'owner' | 'manager',
    permission_profile_id: expected.profile_id,
    permission_profile_version: 1,
    permission_profile_config_hash: expected.config_hash,
    author_role: row.author_role,
    capabilities: expected.capabilities,
    field_paths: Object.freeze(ceiling.filter((fieldPath) => relationFields.includes(fieldPath))),
    link_version: positiveInteger(row.link_version),
    author_relation_version: positiveInteger(row.author_relation_version),
  })
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) invalid()
  if (new Set(value).size !== value.length) invalid()
  return value as readonly string[]
}

function positiveInteger(value: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) invalid()
  return parsed
}

function normalizedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const a = normalizedUnique(left)
  const b = normalizedUnique(right)
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function invalid(): never {
  throw catalogError('AUTHOR_AUTHORIZATION_CONFIGURATION_INVALID', 503, false)
}

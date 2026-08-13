import { createHash } from 'node:crypto'

import type { Pool, QueryResultRow } from 'pg'

import { catalogError } from './errors.js'

export const authorContentP0V1FieldPaths = Object.freeze([
  '/project_core/current_name',
  '/project_core/public_url',
  '/project_core/repository_url',
  '/project_core/original_platform',
  '/project_core/cover_media_reference_ids',
  '/project_core/one_line_definition',
  '/project_core/ai_coding_tools',
  '/project_core/tech_stack',
  '/project_core/deployment_platform',
  '/project_core/access_status',
  '/project_core/status_note',
  '/category_data/target_users',
  '/category_data/core_problem',
  '/category_data/use_scenarios',
  '/category_data/main_inputs',
  '/category_data/main_outputs',
  '/category_data/core_flow',
  '/category_data/content_processing',
  '/category_data/practice_formats',
  '/category_data/feedback_methods',
  '/category_data/learning_records',
  '/category_data/differentiation',
  '/category_data/core_features',
  '/category_data/secondary_features',
  '/category_data/login_requirement',
  '/category_data/sharing_capability',
  '/category_data/site_type',
  '/category_data/creator_roles',
  '/category_data/primary_goals',
  '/category_data/page_model',
  '/category_data/navigation_pattern',
  '/category_data/homepage_sequence',
  '/category_data/core_modules',
  '/category_data/project_showcase_format',
  '/category_data/case_study_depth',
  '/category_data/visual_styles',
  '/category_data/layout_patterns',
  '/category_data/color_character',
  '/category_data/theme_mode',
  '/category_data/interaction_level',
  '/category_data/interaction_patterns',
  '/category_data/responsive_support',
  '/category_data/blog_support',
].sort(compareUnicodeCodePoints))

export type LinkPermissionProfileId = 'OWNER_V1' | 'MANAGER_V1'
export type LinkPermissionProfileFamily = 'owner' | 'manager'
export type LinkPermissionCapability =
  | 'ownership.view'
  | 'project_update.create'
  | 'project_update.submit'

export interface LinkPermissionProfileDefinition {
  readonly profile_id: LinkPermissionProfileId
  readonly profile_family: LinkPermissionProfileFamily
  readonly profile_version: 1
  readonly capabilities: readonly LinkPermissionCapability[]
  readonly field_path_ceiling: readonly string[]
  readonly config_hash: string
}

const expectedHashes = Object.freeze({
  OWNER_V1: '8d9ca77abf8c83611d8eed83bba8318807db6d9c4bd69d6d93f1c83014c69a7c',
  MANAGER_V1: '72f2b162c65ff2d145cb9f38407653b18906e067dd3c43afda8c1a524f56165d',
})

export const linkPermissionProfiles: Readonly<Record<
  LinkPermissionProfileId,
  LinkPermissionProfileDefinition
>> = Object.freeze({
  OWNER_V1: profile('OWNER_V1', 'owner', [
    'ownership.view', 'project_update.create', 'project_update.submit',
  ]),
  MANAGER_V1: profile('MANAGER_V1', 'manager', [
    'project_update.create', 'project_update.submit',
  ]),
})

interface StoredProfileRow extends QueryResultRow {
  readonly profile_id: string
  readonly profile_family: string
  readonly profile_version: number
  readonly capabilities_json: unknown
  readonly field_path_ceiling_json: unknown
  readonly config_hash: string
}

export function computeLinkPermissionProfileHash(input: Readonly<{
  profile_id: string
  profile_family: string
  profile_version: number
  capabilities: readonly string[]
  field_path_ceiling: readonly string[]
}>): string {
  const canonical = JSON.stringify({
    capabilities: normalizedUnique(input.capabilities),
    field_path_ceiling: normalizedUnique(input.field_path_ceiling),
    profile_family: input.profile_family,
    profile_id: input.profile_id,
    profile_version: input.profile_version,
  })
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

export async function validateLinkPermissionProfileDeployment(pool: Pool): Promise<void> {
  const result = await pool.query<StoredProfileRow>(
    `SELECT profile_id,profile_family,profile_version,capabilities_json,
       field_path_ceiling_json,config_hash
     FROM catalog.link_permission_profiles ORDER BY profile_id,profile_version`,
  )
  if (result.rows.length !== 2) invalid()
  for (const expected of Object.values(linkPermissionProfiles)) {
    const row = result.rows.find((candidate) => (
      candidate.profile_id === expected.profile_id &&
      candidate.profile_version === expected.profile_version
    ))
    if (!row) invalid()
    const capabilities = stringArray(row.capabilities_json)
    const fields = stringArray(row.field_path_ceiling_json)
    if (
      row.profile_family !== expected.profile_family ||
      row.config_hash !== expected.config_hash ||
      !sameNormalized(capabilities, expected.capabilities) ||
      !sameNormalized(fields, expected.field_path_ceiling) ||
      computeLinkPermissionProfileHash({
        profile_id: row.profile_id,
        profile_family: row.profile_family,
        profile_version: row.profile_version,
        capabilities,
        field_path_ceiling: fields,
      }) !== expected.config_hash
    ) invalid()
  }
}

function profile(
  profileId: LinkPermissionProfileId,
  family: LinkPermissionProfileFamily,
  capabilities: readonly LinkPermissionCapability[],
): LinkPermissionProfileDefinition {
  const normalizedCapabilities = Object.freeze(normalizedUnique(capabilities)) as readonly LinkPermissionCapability[]
  const definition = {
    profile_id: profileId,
    profile_family: family,
    profile_version: 1 as const,
    capabilities: normalizedCapabilities,
    field_path_ceiling: authorContentP0V1FieldPaths,
  }
  const configHash = computeLinkPermissionProfileHash(definition)
  if (configHash !== expectedHashes[profileId]) invalid()
  return Object.freeze({ ...definition, config_hash: configHash })
}

function normalizedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUnicodeCodePoints)
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const a = [...left]
  const b = [...right]
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = a[index]!.codePointAt(0)! - b[index]!.codePointAt(0)!
    if (difference !== 0) return difference
  }
  return a.length - b.length
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) invalid()
  if (new Set(value).size !== value.length) invalid()
  return value as readonly string[]
}

function sameNormalized(left: readonly string[], right: readonly string[]): boolean {
  const a = normalizedUnique(left)
  const b = normalizedUnique(right)
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function invalid(): never {
  throw catalogError('LINK_PERMISSION_PROFILE_INVALID', 503, false)
}

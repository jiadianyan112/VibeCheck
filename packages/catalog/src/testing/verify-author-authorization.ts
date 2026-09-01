import assert from 'node:assert/strict'

import pg from 'pg'

import { PostgresAuthorAuthorizationResolver } from '../author-authorization.js'
import { CreatorAuthorReadService } from '../creator-author-read.js'
import { linkPermissionProfiles } from '../link-permission-profile.js'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('CONFIG_DATABASE_URL_REQUIRED')
const pool = new Pool({ connectionString: databaseUrl })

const userId = '51000000-0000-4000-8000-000000000001'
const secondUserId = '51000000-0000-4000-8000-000000000002'
const linkId = '52000000-0000-4000-8000-000000000001'
const creatorId = '16000000-0000-4000-8000-000000000001'
const projectId = '10000000-0000-4000-8000-000000000001'
const verificationId = '53000000-0000-4000-8000-000000000001'
const relationId = '19000000-0000-4000-8000-000000000001'

async function run(): Promise<void> {
  await pool.query(
    `INSERT INTO iam.users (user_id) VALUES ($1),($2) ON CONFLICT (user_id) DO NOTHING`,
    [userId, secondUserId],
  )
  await pool.query(
    `INSERT INTO catalog.creator_account_links (
       creator_account_link_id,user_id,creator_id,link_role,permission_profile_id,
       permission_profile_version,permission_profile_config_hash,status,source_verification_id
     ) VALUES ($1,$2,$3,'owner','OWNER_V1',1,$4,'active',$5)
     ON CONFLICT (creator_account_link_id) DO NOTHING`,
    [linkId, userId, creatorId, linkPermissionProfiles.OWNER_V1.config_hash, verificationId],
  )

  const resolver = new PostgresAuthorAuthorizationResolver(pool)
  const authorization = await resolver.requireCapability({
    userId,
    projectId,
    capability: 'project_update.create',
    fieldPaths: ['/project_core/current_name'],
  })
  assert.equal(authorization.grants.length, 1)
  assert.deepEqual(
    authorization.grants[0]?.field_paths,
    ['/category_data/core_problem', '/project_core/current_name'],
  )

  const reads = new CreatorAuthorReadService(pool)
  const link = await reads.getLink(userId, linkId)
  assert.equal(link.creator_account_link_id, linkId)
  assert.equal(link.creator_id, creatorId)
  assert.equal(link.link_role, 'owner')
  assert.equal(link.permission_profile_ref.profile_id, 'OWNER_V1')
  assert.equal(link.permission_profile_ref.config_hash, linkPermissionProfiles.OWNER_V1.config_hash)
  assert(link.effective_capabilities.includes('project_update.create'))

  const myLinks = await reads.listMyLinks(userId)
  assert(myLinks.some((candidate) => candidate.creator_account_link_id === linkId))

  const publicRelation = await reads.getRelation(relationId, null)
  assert.deepEqual(publicRelation, {
    viewer_schema: 'public',
    author_relation_id: relationId,
    project_id: projectId,
    creator_id: creatorId,
    author_role: 'owner',
    status: 'active',
  })

  const selfRelation = await reads.getRelation(relationId, userId)
  assert.equal(selfRelation.viewer_schema, 'self')
  assert.equal(selfRelation.source_creator_account_link_id, linkId)
  assert.deepEqual(
    selfRelation.effective_field_permissions,
    ['/project_core/current_name', '/category_data/core_problem'],
  )

  const byProject = await reads.listRelations({ projectId, creatorId: null, userId: null })
  assert(byProject.some((candidate) => candidate.author_relation_id === relationId))
  const byCreatorForSelf = await reads.listRelations({ creatorId, projectId: null, userId })
  assert(byCreatorForSelf.some((candidate) => (
    candidate.author_relation_id === relationId && candidate.viewer_schema === 'self'
  )))

  await assert.rejects(
    () => reads.getLink(secondUserId, linkId),
    (error: unknown) => (
      error instanceof Error && error.message === 'CREATOR_ACCOUNT_LINK_NOT_FOUND'
    ),
  )

  await assert.rejects(
    () => pool.query(
      `INSERT INTO catalog.creator_account_links (
         user_id,creator_id,link_role,permission_profile_id,permission_profile_version,
         permission_profile_config_hash,status,source_verification_id
       ) VALUES ($1,$2,'owner','OWNER_V1',1,$3,'active',$4)`,
      [secondUserId, creatorId, linkPermissionProfiles.OWNER_V1.config_hash, verificationId],
    ),
    /creator_account_links_owner_nonterminal_uniq/,
  )
  await assert.rejects(
    () => pool.query(
      `INSERT INTO catalog.creator_account_links (
         user_id,creator_id,link_role,permission_profile_id,permission_profile_version,
         permission_profile_config_hash,status,source_verification_id
       ) VALUES ($1,$2,'manager','OWNER_V1',1,$3,'active',$4)`,
      [secondUserId, creatorId, linkPermissionProfiles.OWNER_V1.config_hash, verificationId],
    ),
    /CREATOR_ACCOUNT_LINK_PROFILE_MISMATCH/,
  )
}

try {
  await run()
  process.stdout.write('author_authorization_fixture_ok chain=active fields=2 reads=public+self uniqueness=ok\n')
} finally {
  await pool.end()
}

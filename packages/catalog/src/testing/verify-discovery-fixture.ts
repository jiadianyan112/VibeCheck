import assert from 'node:assert/strict'

import pg from 'pg'

import { CatalogService } from '../service.js'
import { PostgresCatalogStore } from '../store.js'

const connectionString=process.env.DATABASE_URL
if(!connectionString)throw new Error('DATABASE_URL_REQUIRED')
const pool=new pg.Pool({connectionString})

try{
  const counts=await pool.query<{categories:number;topics:number}>(
    `SELECT
       (SELECT count(*)::int FROM taxonomy.categories WHERE status='active') AS categories,
       (SELECT count(*)::int FROM taxonomy.topics WHERE status='active') AS topics`,
  )
  assert.equal(counts.rows[0]?.categories,2)
  assert.equal(counts.rows[0]?.topics,9)

  await pool.query(
    `INSERT INTO taxonomy.topic_aliases(alias_slug,target_topic_id,status)
     VALUES ('daily-learning-practice','38000000-0000-4000-8000-000000000004','active')
     ON CONFLICT(alias_slug) DO NOTHING`,
  )
  const service=new CatalogService({
    store:new PostgresCatalogStore(pool),
    cursorSecret:'catalog-discovery-fixture-secret-at-least-thirty-two-characters',
  })
  const learning=await service.getCategoryTaxonomy('ai_learning_quiz')
  assert.equal(learning.topics.length,8)
  assert.equal(learning.topics.every(({alias_resolved})=>!alias_resolved),true)
  assert.equal(learning.topics.every(({project_count})=>project_count>=0),true)
  const alias=await service.getTopic('daily-learning-practice')
  assert.equal(alias.canonical_slug,'daily-practice')
  assert.equal(alias.alias_resolved,true)
  assert.equal(alias.alias_chain_length,1)

  const events=await service.listPublicEvents({categoryId:null,eventTypes:[],cursor:null})
  assert.equal(events.items.every(({lifecycle_status})=>lifecycle_status==='published'),true)
  assert.equal(events.items.every(({event_sort_rule_version})=>event_sort_rule_version==='event_sort.v1'),true)

  const hidden=await pool.query(
    `SELECT count(*)::int AS count
     FROM taxonomy.topics WHERE status<>'active' AND canonical_slug=ANY($1::text[])`,
    [learning.topics.map(({canonical_slug})=>canonical_slug)],
  )
  assert.equal(hidden.rows[0]?.count,0)
  process.stdout.write(
    `catalog_discovery_fixture_ok categories=2 topics=9 public_events=${events.items.length} alias_chain=1\n`,
  )
}finally{
  await pool.end()
}

-- A primary public developer is distinct from historical author relations.
ALTER TABLE catalog.projects ADD COLUMN IF NOT EXISTS primary_developer_relation_id uuid;
ALTER TABLE catalog.projects ADD COLUMN IF NOT EXISTS developer_management_v1 boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS author_relations_project_relation_unique
  ON catalog.author_relations(project_id, author_relation_id);
ALTER TABLE catalog.projects ADD CONSTRAINT project_primary_developer_relation_fk
  FOREIGN KEY (project_id, primary_developer_relation_id)
  REFERENCES catalog.author_relations(project_id, author_relation_id);

WITH sole_owner AS (
  SELECT project_id, (array_agg(author_relation_id))[1] AS relation_id
  FROM catalog.author_relations
  WHERE status IN ('active', 'suspended') AND author_role='owner'
  GROUP BY project_id HAVING count(*)=1
)
UPDATE catalog.projects project SET primary_developer_relation_id=relation.author_relation_id
FROM sole_owner candidate
JOIN catalog.author_relations relation ON relation.author_relation_id=candidate.relation_id AND relation.status='active'
JOIN catalog.creators creator ON creator.creator_id=relation.creator_id AND creator.merge_status='canonical'
JOIN catalog.creator_account_links link ON link.creator_account_link_id=relation.approved_via_creator_account_link_id AND link.link_role='owner' AND link.status='active'
JOIN workflow.verification_requests verification ON verification.verification_id=relation.source_verification_id AND verification.status='verified'
WHERE project.project_id=candidate.project_id AND project.primary_developer_relation_id IS NULL;

CREATE TABLE IF NOT EXISTS workflow.review_decisions (
  review_decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_request_id varchar(64) NOT NULL,
  work_item_id uuid NOT NULL REFERENCES workflow.review_work_items(work_item_id),
  work_type varchar(32) NOT NULL CHECK (work_type IN (
    'submission','project_update','verification','ownership_case','evidence',
    'recheck','relation','community','creator_profile'
  )),
  target_type varchar(64) NOT NULL CHECK (target_type IN (
    'submission','project_update','verification_request','ownership_case','evidence',
    'recheck_task','relation_candidate','comment','report','creator_profile_draft'
  )),
  target_id uuid NOT NULL,
  decision varchar(64) NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  project_id uuid REFERENCES catalog.projects(project_id),
  base_version_id uuid REFERENCES catalog.project_versions(version_id),
  reason_code varchar(64) NOT NULL,
  field_paths_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision_evidence_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  preview_hash char(64) NOT NULL,
  confirmation_summary_hash char(64) NOT NULL,
  decision_payload_hash char(64) NOT NULL,
  resulting_status varchar(64) NOT NULL,
  transaction_id uuid NOT NULL UNIQUE,
  committed_at timestamptz NOT NULL,
  schema_version varchar(32) NOT NULL DEFAULT 'review_decision.v1',
  CHECK (decision_request_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  CHECK (decision ~ '^[a-z][a-z0-9_]{0,63}$'),
  CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  CHECK (resulting_status ~ '^[a-z][a-z0-9_]{0,63}$'),
  CHECK (jsonb_typeof(field_paths_json) = 'array' AND jsonb_array_length(field_paths_json) <= 50),
  CHECK (
    jsonb_typeof(decision_evidence_refs_json) = 'array'
    AND jsonb_array_length(decision_evidence_refs_json) <= 50
  ),
  CHECK (preview_hash ~ '^[a-f0-9]{64}$'),
  CHECK (confirmation_summary_hash ~ '^[a-f0-9]{64}$'),
  CHECK (decision_payload_hash ~ '^[a-f0-9]{64}$'),
  CHECK (schema_version = 'review_decision.v1'),
  CHECK (
    (work_type='submission' AND target_type='submission') OR
    (work_type='project_update' AND target_type='project_update') OR
    (work_type='verification' AND target_type='verification_request') OR
    (work_type='ownership_case' AND target_type='ownership_case') OR
    (work_type='evidence' AND target_type='evidence') OR
    (work_type='recheck' AND target_type='recheck_task') OR
    (work_type='relation' AND target_type='relation_candidate') OR
    (work_type='community' AND target_type IN ('comment','report')) OR
    (work_type='creator_profile' AND target_type='creator_profile_draft')
  ),
  CHECK (
    work_type <> 'submission' OR (
      decision IN ('approve','changes_requested','reject')
      AND project_id IS NULL AND base_version_id IS NULL
      AND (
        (decision='approve' AND resulting_status='approved') OR
        (decision='changes_requested' AND resulting_status='changes_requested') OR
        (decision='reject' AND resulting_status='rejected')
      )
    )
  ),
  UNIQUE (work_item_id),
  UNIQUE (actor_user_id,work_item_id,decision_request_id)
);

CREATE INDEX IF NOT EXISTS review_decisions_target_time_idx
  ON workflow.review_decisions (target_type,target_id,committed_at DESC,review_decision_id);

CREATE OR REPLACE FUNCTION workflow.reject_review_decision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'REVIEW_DECISION_IMMUTABLE' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS review_decision_immutable ON workflow.review_decisions;
CREATE TRIGGER review_decision_immutable
  BEFORE UPDATE OR DELETE ON workflow.review_decisions
  FOR EACH ROW EXECUTE FUNCTION workflow.reject_review_decision_mutation();

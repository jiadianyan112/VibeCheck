ALTER TABLE workflow.review_work_items
  ADD CONSTRAINT review_work_items_claim_shape_check CHECK (
    (status = 'claimed' AND assignee_user_id IS NOT NULL AND claim_token_hash IS NOT NULL
      AND lease_expires_at IS NOT NULL AND last_heartbeat_at IS NOT NULL)
    OR
    (status <> 'claimed' AND assignee_user_id IS NULL AND claim_token_hash IS NULL
      AND lease_expires_at IS NULL AND last_heartbeat_at IS NULL
      AND conflict_principal_version_at_claim IS NULL)
  ) NOT VALID;

ALTER TABLE workflow.review_work_items
  VALIDATE CONSTRAINT review_work_items_claim_shape_check;

ALTER TABLE workflow.review_work_items
  ADD CONSTRAINT review_work_items_decision_shape_check CHECK (
    (status = 'decided' AND decision_ref_type IS NOT NULL AND decision_ref_id IS NOT NULL)
    OR
    (status <> 'decided' AND decision_ref_type IS NULL AND decision_ref_id IS NULL)
  ) NOT VALID;

ALTER TABLE workflow.review_work_items
  VALIDATE CONSTRAINT review_work_items_decision_shape_check;

ALTER TABLE workflow.review_work_items
  ADD CONSTRAINT review_work_items_decision_type_check CHECK (
    decision_ref_type IS NULL OR decision_ref_type IN (
      'review_decision','creator_profile_execution_decision'
    )
  ) NOT VALID;

ALTER TABLE workflow.review_work_items
  VALIDATE CONSTRAINT review_work_items_decision_type_check;

CREATE TABLE IF NOT EXISTS workflow.review_work_item_conflict_principals (
  work_item_id uuid NOT NULL REFERENCES workflow.review_work_items(work_item_id),
  principal_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  source_type varchar(64) NOT NULL,
  source_id uuid NOT NULL,
  principal_version integer NOT NULL DEFAULT 1 CHECK (principal_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (work_item_id, principal_user_id, source_type, source_id),
  CHECK (source_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX IF NOT EXISTS review_work_item_conflict_active_idx
  ON workflow.review_work_item_conflict_principals (principal_user_id, work_item_id)
  WHERE revoked_at IS NULL;

INSERT INTO workflow.review_work_item_conflict_principals (
  work_item_id,principal_user_id,source_type,source_id,principal_version,created_at
)
SELECT item.work_item_id,comment.author_user_id,'comment_author',comment.comment_id,1,item.created_at
FROM workflow.review_work_items item
JOIN community.comments comment
  ON item.target_type='comment' AND item.target_id=comment.comment_id
WHERE item.work_type='community'
ON CONFLICT DO NOTHING;

INSERT INTO workflow.review_work_item_conflict_principals (
  work_item_id,principal_user_id,source_type,source_id,principal_version,created_at
)
SELECT item.work_item_id,report.reporter_user_id,'reporter',report.report_id,1,report.created_at
FROM workflow.review_work_items item
JOIN community.comment_reports report
  ON item.target_type='comment' AND item.target_id=report.comment_id
WHERE item.work_type='community' AND report.status='open'
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS workflow.review_work_item_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES workflow.review_work_items(work_item_id),
  event_type varchar(32) NOT NULL CHECK (event_type IN (
    'claimed','heartbeat','released','lease_expired','conflict_released','cancelled','decided'
  )),
  actor_user_id uuid REFERENCES iam.users(user_id),
  from_status varchar(16) NOT NULL CHECK (from_status IN ('queued','claimed','decided','cancelled')),
  to_status varchar(16) NOT NULL CHECK (to_status IN ('queued','claimed','decided','cancelled')),
  work_item_version integer NOT NULL CHECK (work_item_version >= 1),
  reason_code varchar(64) NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  CHECK (jsonb_typeof(metadata_json) = 'object')
);

CREATE INDEX IF NOT EXISTS review_work_item_events_item_idx
  ON workflow.review_work_item_events (work_item_id, occurred_at, event_id);

CREATE UNIQUE INDEX IF NOT EXISTS review_work_item_events_item_version_idx
  ON workflow.review_work_item_events (work_item_id, work_item_version);

CREATE TABLE IF NOT EXISTS workflow.review_work_item_release_receipts (
  work_item_id uuid NOT NULL REFERENCES workflow.review_work_items(work_item_id),
  claim_token_hash bytea NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response_json jsonb NOT NULL CHECK (jsonb_typeof(response_json) = 'object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (work_item_id, claim_token_hash)
);

CREATE OR REPLACE FUNCTION workflow.reject_review_work_item_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'REVIEW_WORK_ITEM_EVENT_IMMUTABLE' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS review_work_item_event_immutable ON workflow.review_work_item_events;
CREATE TRIGGER review_work_item_event_immutable
  BEFORE UPDATE OR DELETE ON workflow.review_work_item_events
  FOR EACH ROW EXECUTE FUNCTION workflow.reject_review_work_item_event_mutation();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'submission_drafts_base_submission_fk'
      AND conrelid = 'workflow.submission_drafts'::regclass
  ) THEN
    ALTER TABLE workflow.submission_drafts
      ADD CONSTRAINT submission_drafts_base_submission_fk
      FOREIGN KEY (base_submission_id) REFERENCES workflow.submissions(submission_id);
  END IF;
END;
$$;

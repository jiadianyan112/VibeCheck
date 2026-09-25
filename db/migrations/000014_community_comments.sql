CREATE TABLE IF NOT EXISTS ops.config_versions (
  config_key varchar(128) NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  status varchar(16) NOT NULL CHECK (status IN ('published', 'superseded')),
  value_json jsonb NOT NULL,
  schema_version varchar(64) NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  published_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (config_key, version),
  CHECK (jsonb_typeof(value_json) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS config_versions_one_published_idx
  ON ops.config_versions (config_key) WHERE status = 'published';

CREATE TABLE IF NOT EXISTS workflow.review_work_items (
  work_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_type varchar(32) NOT NULL
    CHECK (work_type IN ('submission','project_update','verification','ownership_case','evidence','recheck','relation','community','creator_profile')),
  target_type varchar(64) NOT NULL
    CHECK (target_type IN ('submission','project_update','verification_request','ownership_case','evidence','recheck_task','relation_candidate','comment','report','creator_profile_draft')),
  target_id uuid NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','claimed','decided','cancelled')),
  assignee_user_id uuid REFERENCES iam.users(user_id),
  claim_token_hash bytea,
  lease_expires_at timestamptz,
  last_heartbeat_at timestamptz,
  conflict_principal_version_at_claim integer,
  decision_ref_type varchar(64),
  decision_ref_id uuid,
  cancel_reason varchar(64),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((decision_ref_type IS NULL) = (decision_ref_id IS NULL)),
  CHECK (
    (status = 'claimed' AND assignee_user_id IS NOT NULL AND claim_token_hash IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'claimed')
  ),
  CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS review_work_items_active_target_idx
  ON workflow.review_work_items (work_type, target_type, target_id)
  WHERE status IN ('queued','claimed');

CREATE INDEX IF NOT EXISTS review_work_items_queue_idx
  ON workflow.review_work_items (work_type, status, created_at, work_item_id)
  WHERE status IN ('queued','claimed');

CREATE TABLE IF NOT EXISTS community.comments (
  comment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES catalog.projects(project_id),
  author_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  parent_comment_id uuid REFERENCES community.comments(comment_id),
  body text NOT NULL,
  moderation_state varchar(32) NOT NULL DEFAULT 'pending'
    CHECK (moderation_state IN ('pending','under_review','visible','collapsed','hidden','rejected','author_withdrawn')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  client_request_id varchar(128) NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  legal_hold boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  author_withdrawn_at timestamptz,
  UNIQUE (author_user_id, client_request_id),
  CHECK (char_length(body) BETWEEN 1 AND 2000),
  CHECK (length(client_request_id) BETWEEN 8 AND 128),
  CHECK ((moderation_state = 'author_withdrawn') = (author_withdrawn_at IS NOT NULL)),
  CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS comments_public_page_idx
  ON community.comments (project_id, created_at DESC, comment_id DESC)
  WHERE moderation_state IN ('visible','collapsed');

CREATE INDEX IF NOT EXISTS comments_parent_idx
  ON community.comments (parent_comment_id, created_at, comment_id)
  WHERE parent_comment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS community.comment_operation_receipts (
  comment_id uuid NOT NULL REFERENCES community.comments(comment_id),
  operation_id varchar(128) NOT NULL,
  operation_type varchar(32) NOT NULL CHECK (operation_type IN ('withdraw','moderate')),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response_json jsonb NOT NULL CHECK (jsonb_typeof(response_json) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, operation_id)
);

CREATE TABLE IF NOT EXISTS community.comment_reports (
  report_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES community.comments(comment_id),
  project_id uuid NOT NULL REFERENCES catalog.projects(project_id),
  reporter_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  reason_code varchar(64) NOT NULL,
  note_ciphertext bytea,
  note_key_version varchar(64),
  status varchar(32) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','resolved_actioned','resolved_no_action','withdrawn')),
  review_work_item_id uuid REFERENCES workflow.review_work_items(work_item_id),
  decision_id uuid,
  client_request_id varchar(128) NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (reporter_user_id, client_request_id),
  CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  CHECK ((note_ciphertext IS NULL) = (note_key_version IS NULL)),
  CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS comment_reports_active_reason_idx
  ON community.comment_reports (reporter_user_id, comment_id, reason_code)
  WHERE status = 'open';

CREATE TABLE IF NOT EXISTS community.report_operation_receipts (
  reporter_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  client_request_id varchar(128) NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  report_id uuid NOT NULL REFERENCES community.comment_reports(report_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reporter_user_id, client_request_id)
);

CREATE TABLE IF NOT EXISTS community.rate_limit_buckets (
  scope_type varchar(64) NOT NULL CHECK (scope_type IN ('comment_create','comment_report')),
  user_id uuid NOT NULL REFERENCES iam.users(user_id),
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL CHECK (attempt_count >= 0),
  policy_version integer NOT NULL CHECK (policy_version >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_type, user_id)
);

CREATE OR REPLACE FUNCTION community.validate_comment_parent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_record record;
BEGIN
  IF NEW.parent_comment_id IS NULL THEN RETURN NEW; END IF;
  SELECT project_id, moderation_state INTO parent_record
  FROM community.comments WHERE comment_id = NEW.parent_comment_id;
  IF parent_record.project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'COMMENT_PARENT_PROJECT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF parent_record.moderation_state NOT IN ('visible','collapsed') THEN
    RAISE EXCEPTION 'COMMENT_PARENT_NOT_REPLYABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comment_parent_valid ON community.comments;
CREATE TRIGGER comment_parent_valid
  BEFORE INSERT OR UPDATE OF parent_comment_id, project_id ON community.comments
  FOR EACH ROW EXECUTE FUNCTION community.validate_comment_parent();

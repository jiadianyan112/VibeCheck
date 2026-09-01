CREATE TABLE IF NOT EXISTS workflow.submission_url_checks (
  check_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  category_id varchar(64) NOT NULL,
  category_schema_version varchar(32) NOT NULL,
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  canonical_url varchar(2048),
  canonical_url_hash bytea,
  redirect_chain_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_result varchar(16) NOT NULL CHECK (risk_result IN ('allowed','blocked','uncertain')),
  access_result varchar(16) NOT NULL
    CHECK (access_result IN ('accessible','unavailable','uncertain','not_checked')),
  category_result varchar(16) NOT NULL DEFAULT 'unconfirmed'
    CHECK (category_result IN ('matched','mismatched','unconfirmed')),
  duplicate_result varchar(16) NOT NULL DEFAULT 'none'
    CHECK (duplicate_result IN ('none','exact','candidate')),
  duplicate_candidates_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_reasons_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  client_request_id varchar(128) NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  request_id varchar(128) NOT NULL,
  checked_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, client_request_id),
  FOREIGN KEY (category_id, category_schema_version)
    REFERENCES taxonomy.category_schema_versions(category_id, schema_version),
  CHECK (jsonb_typeof(redirect_chain_json) = 'array'),
  CHECK (jsonb_typeof(duplicate_candidates_json) = 'array'),
  CHECK (jsonb_typeof(risk_reasons_json) = 'array'),
  CHECK ((canonical_url IS NULL) = (canonical_url_hash IS NULL)),
  CHECK (expires_at > checked_at)
);

CREATE INDEX IF NOT EXISTS submission_url_checks_reuse_idx
  ON workflow.submission_url_checks (owner_user_id, input_hash, expires_at DESC);

CREATE INDEX IF NOT EXISTS submission_url_checks_canonical_idx
  ON workflow.submission_url_checks (canonical_url_hash, checked_at DESC)
  WHERE canonical_url_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS workflow.submission_url_check_receipts (
  owner_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  client_request_id varchar(128) NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  check_id uuid NOT NULL REFERENCES workflow.submission_url_checks(check_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, client_request_id)
);

CREATE TABLE IF NOT EXISTS workflow.submission_drafts (
  draft_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_chain_id uuid NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  category_id varchar(64) NOT NULL,
  category_schema_version varchar(32) NOT NULL,
  check_id uuid NOT NULL REFERENCES workflow.submission_url_checks(check_id),
  draft_revision integer NOT NULL DEFAULT 1 CHECK (draft_revision >= 1),
  supersedes_draft_id uuid REFERENCES workflow.submission_drafts(draft_id),
  base_submission_id uuid,
  payload_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  media_reference_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_draft_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  asset_drafts_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  status varchar(16) NOT NULL DEFAULT 'editing'
    CHECK (status IN ('editing','submitted','closed','expired')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  idempotency_key varchar(128) NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  saved_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE (owner_user_id, idempotency_key),
  FOREIGN KEY (category_id, category_schema_version)
    REFERENCES taxonomy.category_schema_versions(category_id, schema_version),
  CHECK (jsonb_typeof(payload_snapshot) = 'object'),
  CHECK (octet_length(payload_snapshot::text) <= 524288),
  CHECK (jsonb_typeof(media_reference_ids_json) = 'array'),
  CHECK (jsonb_array_length(media_reference_ids_json) <= 20),
  CHECK (jsonb_typeof(evidence_draft_ids_json) = 'array'),
  CHECK (jsonb_array_length(evidence_draft_ids_json) <= 50),
  CHECK (jsonb_typeof(asset_drafts_json) = 'array'),
  CHECK (expires_at > created_at),
  CHECK (updated_at >= created_at AND saved_at >= created_at),
  CHECK (
    (draft_revision = 1 AND supersedes_draft_id IS NULL AND base_submission_id IS NULL)
    OR (draft_revision > 1 AND supersedes_draft_id IS NOT NULL AND base_submission_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS submission_drafts_one_editing_chain_idx
  ON workflow.submission_drafts (submission_chain_id) WHERE status = 'editing';

CREATE INDEX IF NOT EXISTS submission_drafts_owner_idx
  ON workflow.submission_drafts (owner_user_id, status, updated_at DESC, draft_id);

CREATE TABLE IF NOT EXISTS workflow.submission_draft_operation_receipts (
  draft_id uuid NOT NULL REFERENCES workflow.submission_drafts(draft_id),
  operation_id varchar(128) NOT NULL,
  operation_type varchar(32) NOT NULL CHECK (operation_type IN ('patch')),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response_json jsonb NOT NULL CHECK (jsonb_typeof(response_json) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (draft_id, operation_id)
);

CREATE TABLE IF NOT EXISTS workflow.submissions (
  submission_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_chain_id uuid NOT NULL,
  supersedes_submission_id uuid REFERENCES workflow.submissions(submission_id),
  draft_id uuid NOT NULL UNIQUE REFERENCES workflow.submission_drafts(draft_id),
  owner_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  snapshot_version integer NOT NULL CHECK (snapshot_version >= 1),
  payload_snapshot jsonb NOT NULL,
  evidence_draft_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_status varchar(32) NOT NULL DEFAULT 'pending_review'
    CHECK (review_status IN (
      'pending_review','changes_requested','rejected','withdrawn','approved',
      'publishing','publish_failed','published'
    )),
  review_work_item_id uuid NOT NULL REFERENCES workflow.review_work_items(work_item_id),
  resulting_project_id uuid REFERENCES catalog.projects(project_id),
  promoted_evidence_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  publish_attempt_count integer NOT NULL DEFAULT 0 CHECK (publish_attempt_count >= 0),
  last_error_code varchar(128),
  idempotency_key varchar(128) NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  decided_at timestamptz,
  published_at timestamptz,
  UNIQUE (owner_user_id, idempotency_key),
  CHECK (jsonb_typeof(payload_snapshot) = 'object'),
  CHECK (octet_length(payload_snapshot::text) <= 524288),
  CHECK (jsonb_typeof(evidence_draft_ids_json) = 'array'),
  CHECK (jsonb_typeof(promoted_evidence_ids_json) = 'array'),
  CHECK ((review_status = 'published') = (resulting_project_id IS NOT NULL)),
  CHECK ((review_status = 'published') = (published_at IS NOT NULL)),
  CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS submissions_owner_status_idx
  ON workflow.submissions (owner_user_id, review_status, updated_at DESC, submission_id);

CREATE OR REPLACE FUNCTION workflow.reject_submitted_draft_reopen()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF
    NEW.draft_id IS DISTINCT FROM OLD.draft_id OR
    NEW.submission_chain_id IS DISTINCT FROM OLD.submission_chain_id OR
    NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR
    NEW.category_id IS DISTINCT FROM OLD.category_id OR
    NEW.category_schema_version IS DISTINCT FROM OLD.category_schema_version OR
    NEW.check_id IS DISTINCT FROM OLD.check_id OR
    NEW.draft_revision IS DISTINCT FROM OLD.draft_revision OR
    NEW.supersedes_draft_id IS DISTINCT FROM OLD.supersedes_draft_id OR
    NEW.base_submission_id IS DISTINCT FROM OLD.base_submission_id OR
    NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR
    NEW.request_hash IS DISTINCT FROM OLD.request_hash OR
    NEW.created_at IS DISTINCT FROM OLD.created_at OR
    NEW.expires_at IS DISTINCT FROM OLD.expires_at
  THEN
    RAISE EXCEPTION 'SUBMISSION_DRAFT_IDENTITY_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF OLD.status <> 'editing' AND NEW.status = 'editing' THEN
    RAISE EXCEPTION 'SUBMISSION_DRAFT_REOPEN_FORBIDDEN' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'submitted' AND NEW.status <> 'submitted' THEN
    RAISE EXCEPTION 'SUBMISSION_DRAFT_SUBMITTED_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'editing' AND (
    NEW.payload_snapshot IS DISTINCT FROM OLD.payload_snapshot OR
    NEW.media_reference_ids_json IS DISTINCT FROM OLD.media_reference_ids_json OR
    NEW.evidence_draft_ids_json IS DISTINCT FROM OLD.evidence_draft_ids_json OR
    NEW.asset_drafts_json IS DISTINCT FROM OLD.asset_drafts_json
  ) THEN
    RAISE EXCEPTION 'SUBMISSION_DRAFT_CONTENT_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS submission_draft_no_reopen ON workflow.submission_drafts;
CREATE TRIGGER submission_draft_no_reopen
  BEFORE UPDATE ON workflow.submission_drafts
  FOR EACH ROW EXECUTE FUNCTION workflow.reject_submitted_draft_reopen();

CREATE OR REPLACE FUNCTION workflow.protect_submission_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF
    NEW.submission_id IS DISTINCT FROM OLD.submission_id OR
    NEW.submission_chain_id IS DISTINCT FROM OLD.submission_chain_id OR
    NEW.supersedes_submission_id IS DISTINCT FROM OLD.supersedes_submission_id OR
    NEW.draft_id IS DISTINCT FROM OLD.draft_id OR
    NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR
    NEW.snapshot_version IS DISTINCT FROM OLD.snapshot_version OR
    NEW.payload_snapshot IS DISTINCT FROM OLD.payload_snapshot OR
    NEW.evidence_draft_ids_json IS DISTINCT FROM OLD.evidence_draft_ids_json OR
    NEW.review_work_item_id IS DISTINCT FROM OLD.review_work_item_id OR
    NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR
    NEW.request_hash IS DISTINCT FROM OLD.request_hash OR
    NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'SUBMISSION_SNAPSHOT_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS submission_snapshot_immutable ON workflow.submissions;
CREATE TRIGGER submission_snapshot_immutable
  BEFORE UPDATE ON workflow.submissions
  FOR EACH ROW EXECUTE FUNCTION workflow.protect_submission_snapshot();

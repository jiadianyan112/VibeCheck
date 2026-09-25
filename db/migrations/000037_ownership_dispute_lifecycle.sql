CREATE TABLE IF NOT EXISTS workflow.ownership_cases (
  case_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES catalog.projects(project_id),
  author_relation_id uuid NOT NULL REFERENCES catalog.author_relations(author_relation_id),
  opened_by_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  appealed_user_id uuid REFERENCES iam.users(user_id),
  reason_code varchar(64) NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  status varchar(32) NOT NULL DEFAULT 'open' CHECK (status IN (
    'open','investigating','resolved_upheld','resolved_revoked','withdrawn'
  )),
  review_work_item_id uuid NOT NULL REFERENCES workflow.review_work_items(work_item_id),
  decision varchar(16) CHECK (decision IN ('uphold','revoke','withdraw')),
  decided_by_user_id uuid REFERENCES iam.users(user_id),
  review_decision_id uuid,
  active_withdrawal_request_id uuid,
  latest_withdrawal_request_id uuid,
  conflict_principal_version integer NOT NULL DEFAULT 1 CHECK (conflict_principal_version >= 1),
  conflict_principal_hash char(64) NOT NULL CHECK (conflict_principal_hash ~ '^[a-f0-9]{64}$'),
  resulting_author_relation_status varchar(16) CHECK (
    resulting_author_relation_status IN ('active','suspended','terminated')
  ),
  resulting_project_status varchar(32) CHECK (
    resulting_project_status IN ('published_platform','published_author','restricted','archived','deleted')
  ),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  decided_at timestamptz,
  CHECK (updated_at >= created_at),
  CHECK ((decision IS NULL) = (decided_by_user_id IS NULL)),
  CHECK ((decision IS NULL) = (review_decision_id IS NULL)),
  CHECK ((decision IS NULL) = (decided_at IS NULL)),
  CHECK (
    (status IN ('open','investigating') AND decision IS NULL)
    OR (status='resolved_upheld' AND decision='uphold')
    OR (status='resolved_revoked' AND decision='revoke')
    OR (status='withdrawn' AND decision='withdraw')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ownership_cases_active_relation_uniq
  ON workflow.ownership_cases (author_relation_id)
  WHERE status IN ('open','investigating');

CREATE INDEX IF NOT EXISTS ownership_cases_project_history_idx
  ON workflow.ownership_cases (project_id,created_at DESC,case_id DESC);

CREATE TABLE IF NOT EXISTS workflow.ownership_case_evidence_submissions (
  evidence_submission_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES workflow.ownership_cases(case_id),
  evidence_id uuid NOT NULL REFERENCES catalog.evidence(evidence_id),
  submitted_by_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  summary varchar(1000) NOT NULL,
  reason_code varchar(64) NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  client_request_id varchar(128) NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  submitted_at timestamptz NOT NULL,
  UNIQUE (case_id,evidence_id),
  UNIQUE (case_id,submitted_by_user_id,client_request_id)
);

CREATE INDEX IF NOT EXISTS ownership_evidence_case_time_idx
  ON workflow.ownership_case_evidence_submissions (case_id,submitted_at,evidence_submission_id);

CREATE TABLE IF NOT EXISTS workflow.ownership_withdrawal_requests (
  withdrawal_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES workflow.ownership_cases(case_id),
  requested_by_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  reason_code varchar(64) NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  evidence_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  client_request_id varchar(128) NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  status varchar(32) NOT NULL DEFAULT 'requested' CHECK (status IN (
    'requested','rejected','accepted','closed_by_case_decision'
  )),
  supersedes_request_id uuid REFERENCES workflow.ownership_withdrawal_requests(withdrawal_request_id),
  decision_id uuid,
  decided_by_user_id uuid REFERENCES iam.users(user_id),
  decision_reason_code varchar(64) CHECK (
    decision_reason_code IS NULL OR decision_reason_code ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL,
  decided_at timestamptz,
  CHECK (jsonb_typeof(evidence_ids_json)='array' AND jsonb_array_length(evidence_ids_json)<=20),
  CHECK ((status='requested') = (decided_at IS NULL)),
  CHECK ((status='requested') = (decision_id IS NULL)),
  CHECK ((status='requested') = (decided_by_user_id IS NULL)),
  UNIQUE (case_id,requested_by_user_id,client_request_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ownership_withdrawal_one_requested_uniq
  ON workflow.ownership_withdrawal_requests (case_id) WHERE status='requested';

CREATE UNIQUE INDEX IF NOT EXISTS ownership_withdrawal_supersedes_uniq
  ON workflow.ownership_withdrawal_requests (supersedes_request_id)
  WHERE supersedes_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ownership_withdrawal_case_history_idx
  ON workflow.ownership_withdrawal_requests (case_id,created_at,withdrawal_request_id);

CREATE UNIQUE INDEX IF NOT EXISTS ownership_withdrawal_decision_uniq
  ON workflow.ownership_withdrawal_requests (decision_id) WHERE decision_id IS NOT NULL;

ALTER TABLE workflow.ownership_cases
  ADD CONSTRAINT ownership_cases_active_withdrawal_fk
  FOREIGN KEY (active_withdrawal_request_id)
  REFERENCES workflow.ownership_withdrawal_requests(withdrawal_request_id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE workflow.ownership_cases
  ADD CONSTRAINT ownership_cases_latest_withdrawal_fk
  FOREIGN KEY (latest_withdrawal_request_id)
  REFERENCES workflow.ownership_withdrawal_requests(withdrawal_request_id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE workflow.ownership_cases
  ADD CONSTRAINT ownership_cases_review_decision_fk
  FOREIGN KEY (review_decision_id) REFERENCES workflow.review_decisions(review_decision_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS workflow.ownership_conflict_principal_snapshots (
  case_id uuid NOT NULL REFERENCES workflow.ownership_cases(case_id),
  conflict_principal_version integer NOT NULL CHECK (conflict_principal_version >= 1),
  principal_hash char(64) NOT NULL CHECK (principal_hash ~ '^[a-f0-9]{64}$'),
  source_versions_json jsonb NOT NULL,
  calculated_at timestamptz NOT NULL,
  PRIMARY KEY (case_id,conflict_principal_version),
  UNIQUE (case_id,principal_hash),
  CHECK (jsonb_typeof(source_versions_json)='object')
);

CREATE TABLE IF NOT EXISTS workflow.ownership_conflict_principal_members (
  case_id uuid NOT NULL,
  conflict_principal_version integer NOT NULL,
  principal_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  principal_reason varchar(32) NOT NULL CHECK (principal_reason IN (
    'opened_by','withdrawal_requester','original_applicant','creator_link_principal',
    'case_evidence_submitter','appealed_account'
  )),
  source_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (case_id,conflict_principal_version,principal_user_id,principal_reason,source_id),
  FOREIGN KEY (case_id,conflict_principal_version)
    REFERENCES workflow.ownership_conflict_principal_snapshots(case_id,conflict_principal_version)
);

CREATE INDEX IF NOT EXISTS ownership_conflict_member_user_idx
  ON workflow.ownership_conflict_principal_members (principal_user_id,case_id,conflict_principal_version);

CREATE TABLE IF NOT EXISTS workflow.ownership_operation_receipts (
  case_id uuid NOT NULL REFERENCES workflow.ownership_cases(case_id),
  actor_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  operation_type varchar(32) NOT NULL CHECK (operation_type IN (
    'create','add_evidence','request_withdrawal','reject_withdrawal'
  )),
  client_request_id varchar(128) NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response_json jsonb NOT NULL CHECK (jsonb_typeof(response_json)='object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (case_id,actor_user_id,operation_type,client_request_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ownership_create_receipt_actor_request_uniq
  ON workflow.ownership_operation_receipts (actor_user_id,client_request_id)
  WHERE operation_type='create';

CREATE OR REPLACE FUNCTION workflow.validate_ownership_case_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.project_id<>OLD.project_id OR NEW.author_relation_id<>OLD.author_relation_id
     OR NEW.opened_by_user_id<>OLD.opened_by_user_id
     OR NEW.appealed_user_id IS DISTINCT FROM OLD.appealed_user_id
     OR NEW.reason_code<>OLD.reason_code OR NEW.review_work_item_id<>OLD.review_work_item_id
     OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'OWNERSHIP_CASE_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at THEN
    RAISE EXCEPTION 'OWNERSHIP_CASE_VERSION_INVALID' USING ERRCODE='23514';
  END IF;
  IF OLD.status IN ('resolved_upheld','resolved_revoked','withdrawn') THEN
    RAISE EXCEPTION 'OWNERSHIP_CASE_TERMINAL_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF NOT (
    (OLD.status='open' AND NEW.status IN ('open','investigating','resolved_upheld','resolved_revoked','withdrawn')) OR
    (OLD.status='investigating' AND NEW.status IN ('investigating','resolved_upheld','resolved_revoked','withdrawn'))
  ) THEN
    RAISE EXCEPTION 'OWNERSHIP_CASE_TRANSITION_INVALID' USING ERRCODE='23514';
  END IF;
  IF NEW.conflict_principal_version<OLD.conflict_principal_version
     OR NEW.conflict_principal_version>OLD.conflict_principal_version+1 THEN
    RAISE EXCEPTION 'OWNERSHIP_CONFLICT_VERSION_INVALID' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ownership_cases_validate
  BEFORE UPDATE ON workflow.ownership_cases
  FOR EACH ROW EXECUTE FUNCTION workflow.validate_ownership_case_mutation();

CREATE OR REPLACE FUNCTION workflow.validate_ownership_withdrawal_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.case_id<>OLD.case_id OR NEW.requested_by_user_id<>OLD.requested_by_user_id
     OR NEW.reason_code<>OLD.reason_code OR NEW.evidence_ids_json<>OLD.evidence_ids_json
     OR NEW.client_request_id<>OLD.client_request_id OR NEW.request_hash<>OLD.request_hash
     OR NEW.supersedes_request_id IS DISTINCT FROM OLD.supersedes_request_id
     OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'OWNERSHIP_WITHDRAWAL_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF OLD.status<>'requested' OR NEW.status NOT IN ('rejected','accepted','closed_by_case_decision')
     OR NEW.version<>OLD.version+1 THEN
    RAISE EXCEPTION 'OWNERSHIP_WITHDRAWAL_TRANSITION_INVALID' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ownership_withdrawal_validate
  BEFORE UPDATE ON workflow.ownership_withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION workflow.validate_ownership_withdrawal_mutation();

CREATE TRIGGER ownership_evidence_immutable
  BEFORE UPDATE OR DELETE ON workflow.ownership_case_evidence_submissions
  FOR EACH ROW EXECUTE FUNCTION catalog.reject_immutable_mutation();

CREATE TRIGGER ownership_conflict_snapshots_immutable
  BEFORE UPDATE OR DELETE ON workflow.ownership_conflict_principal_snapshots
  FOR EACH ROW EXECUTE FUNCTION catalog.reject_immutable_mutation();

CREATE TRIGGER ownership_conflict_members_immutable
  BEFORE UPDATE OR DELETE ON workflow.ownership_conflict_principal_members
  FOR EACH ROW EXECUTE FUNCTION catalog.reject_immutable_mutation();

CREATE TRIGGER ownership_operation_receipts_immutable
  BEFORE UPDATE OR DELETE ON workflow.ownership_operation_receipts
  FOR EACH ROW EXECUTE FUNCTION catalog.reject_immutable_mutation();

CREATE TRIGGER ownership_withdrawal_no_delete
  BEFORE DELETE ON workflow.ownership_withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION catalog.reject_immutable_mutation();

ALTER TABLE workflow.review_decisions
  ADD CONSTRAINT review_decisions_ownership_shape_check
  CHECK (
    work_type <> 'ownership_case' OR (
      target_type='ownership_case' AND project_id IS NOT NULL AND base_version_id IS NULL
      AND decision IN ('uphold','revoke','withdraw')
      AND (
        (decision='uphold' AND resulting_status='resolved_upheld') OR
        (decision='revoke' AND resulting_status='resolved_revoked') OR
        (decision='withdraw' AND resulting_status='withdrawn')
      )
    )
  );

CREATE TABLE IF NOT EXISTS workflow.verification_requests (
  verification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES catalog.projects(project_id),
  applicant_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  creator_resolution_mode varchar(32) NOT NULL CHECK (creator_resolution_mode IN (
    'use_existing_link','create_new_creator','claim_existing_creator'
  )),
  creator_account_link_id uuid REFERENCES catalog.creator_account_links(creator_account_link_id),
  target_creator_id uuid REFERENCES catalog.creators(creator_id),
  new_creator_profile_input_json jsonb,
  requested_link_role varchar(16) CHECK (requested_link_role IN ('owner','manager')),
  link_policy_snapshot_json jsonb,
  method varchar(64),
  public_summary varchar(1000),
  material_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  status varchar(32) NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','pending','changes_requested','verified','failed','withdrawn'
  )),
  status_history_json jsonb NOT NULL,
  review_work_item_id uuid REFERENCES workflow.review_work_items(work_item_id),
  decision varchar(16) CHECK (decision IN ('approve','reject','withdraw')),
  resulting_creator_id uuid REFERENCES catalog.creators(creator_id),
  resulting_link_id uuid REFERENCES catalog.creator_account_links(creator_account_link_id),
  resulting_author_relation_id uuid REFERENCES catalog.author_relations(author_relation_id),
  resulting_profile_version_id uuid REFERENCES catalog.creator_profile_versions(creator_profile_version_id),
  approved_link_role varchar(16) CHECK (approved_link_role IN ('owner','manager')),
  approved_permission_profile_id varchar(32),
  approved_permission_profile_version integer,
  approved_profile_config_hash char(64),
  supersedes_verification_id uuid REFERENCES workflow.verification_requests(verification_id),
  idempotency_key varchar(128) NOT NULL,
  request_hash char(64) NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  decided_at timestamptz,
  CHECK (jsonb_typeof(status_history_json)='array'),
  CHECK (jsonb_typeof(material_ids_json)='array'),
  CHECK (link_policy_snapshot_json IS NULL OR jsonb_typeof(link_policy_snapshot_json)='object'),
  CHECK (new_creator_profile_input_json IS NULL OR jsonb_typeof(new_creator_profile_input_json)='object'),
  CHECK (jsonb_array_length(material_ids_json)<=20),
  CHECK (updated_at>=created_at),
  CHECK (supersedes_verification_id IS NULL OR supersedes_verification_id<>verification_id),
  CHECK (
    (creator_resolution_mode='use_existing_link' AND creator_account_link_id IS NOT NULL
      AND target_creator_id IS NULL AND new_creator_profile_input_json IS NULL
      AND requested_link_role IS NULL)
    OR
    (creator_resolution_mode='create_new_creator' AND creator_account_link_id IS NULL
      AND target_creator_id IS NULL AND new_creator_profile_input_json IS NOT NULL
      AND requested_link_role='owner')
    OR
    (creator_resolution_mode='claim_existing_creator' AND creator_account_link_id IS NULL
      AND target_creator_id IS NOT NULL AND new_creator_profile_input_json IS NULL)
  )
);

CREATE UNIQUE INDEX verification_requests_create_idempotency_uniq
  ON workflow.verification_requests (applicant_user_id,idempotency_key);

CREATE UNIQUE INDEX verification_requests_active_chain_uniq
  ON workflow.verification_requests (applicant_user_id,project_id)
  WHERE status IN ('draft','pending','changes_requested');

CREATE UNIQUE INDEX verification_requests_supersedes_uniq
  ON workflow.verification_requests (supersedes_verification_id)
  WHERE supersedes_verification_id IS NOT NULL;

CREATE INDEX verification_requests_owner_project_history_idx
  ON workflow.verification_requests (applicant_user_id,project_id,created_at DESC,verification_id DESC);

CREATE TABLE IF NOT EXISTS workflow.verification_request_operations (
  verification_id uuid NOT NULL REFERENCES workflow.verification_requests(verification_id),
  applicant_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  operation_id varchar(128) NOT NULL,
  operation_type varchar(16) NOT NULL CHECK (operation_type IN ('patch')),
  request_hash char(64) NOT NULL,
  resulting_version bigint NOT NULL CHECK (resulting_version>=1),
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (verification_id,applicant_user_id,operation_id),
  CHECK (jsonb_typeof(response_json)='object')
);

CREATE OR REPLACE FUNCTION workflow.validate_verification_request_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.project_id<>OLD.project_id OR NEW.applicant_user_id<>OLD.applicant_user_id
     OR NEW.supersedes_verification_id IS DISTINCT FROM OLD.supersedes_verification_id
     OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.request_hash<>OLD.request_hash
     OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'VERIFICATION_REQUEST_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at THEN
    RAISE EXCEPTION 'VERIFICATION_REQUEST_VERSION_INVALID' USING ERRCODE='23514';
  END IF;
  IF OLD.status IN ('verified','failed','withdrawn') THEN
    RAISE EXCEPTION 'VERIFICATION_REQUEST_TERMINAL_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF NOT (
    (OLD.status='draft' AND NEW.status IN ('draft','pending','withdrawn')) OR
    (OLD.status='pending' AND NEW.status IN ('pending','changes_requested','verified','failed','withdrawn')) OR
    (OLD.status='changes_requested' AND NEW.status IN ('changes_requested','pending','withdrawn'))
  ) THEN
    RAISE EXCEPTION 'VERIFICATION_REQUEST_TRANSITION_INVALID' USING ERRCODE='23514';
  END IF;
  IF (
    NEW.creator_resolution_mode IS DISTINCT FROM OLD.creator_resolution_mode OR
    NEW.creator_account_link_id IS DISTINCT FROM OLD.creator_account_link_id OR
    NEW.target_creator_id IS DISTINCT FROM OLD.target_creator_id OR
    NEW.new_creator_profile_input_json IS DISTINCT FROM OLD.new_creator_profile_input_json OR
    NEW.requested_link_role IS DISTINCT FROM OLD.requested_link_role OR
    NEW.method IS DISTINCT FROM OLD.method OR
    NEW.public_summary IS DISTINCT FROM OLD.public_summary
  ) AND NOT (OLD.status IN ('draft','changes_requested') AND NEW.status=OLD.status) THEN
    RAISE EXCEPTION 'VERIFICATION_REQUEST_DRAFT_FIELDS_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER verification_requests_validate_mutation
  BEFORE UPDATE ON workflow.verification_requests
  FOR EACH ROW EXECUTE FUNCTION workflow.validate_verification_request_mutation();

CREATE TRIGGER verification_requests_no_delete
  BEFORE DELETE ON workflow.verification_requests
  FOR EACH ROW EXECUTE FUNCTION catalog.reject_immutable_mutation();

CREATE TRIGGER verification_request_operations_immutable
  BEFORE UPDATE OR DELETE ON workflow.verification_request_operations
  FOR EACH ROW EXECUTE FUNCTION catalog.reject_immutable_mutation();

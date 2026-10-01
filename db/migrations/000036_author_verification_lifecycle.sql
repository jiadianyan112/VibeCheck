ALTER TABLE workflow.verification_request_operations
  DROP CONSTRAINT IF EXISTS verification_request_operations_operation_type_check;

ALTER TABLE workflow.verification_request_operations
  ADD CONSTRAINT verification_request_operations_operation_type_check
  CHECK (operation_type IN ('patch','submit','supplement','withdraw'));

ALTER TABLE workflow.verification_requests
  ADD CONSTRAINT verification_requests_material_limit_check
  CHECK (jsonb_array_length(material_ids_json) <= 5) NOT VALID;

ALTER TABLE workflow.verification_requests
  VALIDATE CONSTRAINT verification_requests_material_limit_check;

CREATE TABLE IF NOT EXISTS workflow.verification_request_submissions (
  verification_submission_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id uuid NOT NULL REFERENCES workflow.verification_requests(verification_id),
  revision_number integer NOT NULL CHECK (revision_number >= 1),
  submission_kind varchar(16) NOT NULL CHECK (submission_kind IN ('initial','supplement')),
  material_ids_json jsonb NOT NULL,
  evidence_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  link_policy_snapshot_json jsonb NOT NULL,
  review_work_item_id uuid NOT NULL REFERENCES workflow.review_work_items(work_item_id),
  operation_id varchar(128) NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  UNIQUE (verification_id,revision_number),
  UNIQUE (verification_id,operation_id),
  UNIQUE (review_work_item_id),
  CHECK (jsonb_typeof(material_ids_json)='array'),
  CHECK (jsonb_array_length(material_ids_json) BETWEEN 1 AND 5),
  CHECK (jsonb_typeof(evidence_refs_json)='array'),
  CHECK (jsonb_array_length(evidence_refs_json) <= 50),
  CHECK (jsonb_typeof(link_policy_snapshot_json)='object')
);

CREATE INDEX IF NOT EXISTS verification_request_submissions_history_idx
  ON workflow.verification_request_submissions (verification_id,revision_number DESC);

CREATE TRIGGER verification_request_submissions_immutable
  BEFORE UPDATE OR DELETE ON workflow.verification_request_submissions
  FOR EACH ROW EXECUTE FUNCTION catalog.reject_immutable_mutation();

ALTER TABLE workflow.review_decisions
  ADD CONSTRAINT review_decisions_verification_shape_check
  CHECK (
    work_type <> 'verification' OR (
      target_type='verification_request'
      AND project_id IS NOT NULL
      AND base_version_id IS NULL
      AND decision IN ('approve','changes_requested','reject')
      AND (
        (decision='approve' AND resulting_status='verified') OR
        (decision='changes_requested' AND resulting_status='changes_requested') OR
        (decision='reject' AND resulting_status='failed')
      )
    )
  );

ALTER TABLE catalog.author_relations
  ADD COLUMN IF NOT EXISTS approved_via_creator_account_link_id uuid
  REFERENCES catalog.creator_account_links(creator_account_link_id);

UPDATE catalog.author_relations SET author_role='owner' WHERE author_role='creator';

ALTER TABLE catalog.author_relations
  ADD CONSTRAINT author_relations_role_v1_check
  CHECK (author_role IN ('owner','co_creator','maintainer')) NOT VALID;

ALTER TABLE catalog.author_relations
  VALIDATE CONSTRAINT author_relations_role_v1_check;

CREATE UNIQUE INDEX IF NOT EXISTS author_relations_creator_project_nonterminal_uniq
  ON catalog.author_relations (creator_id,project_id)
  WHERE status IN ('active','suspended');

ALTER TABLE catalog.creator_account_links
  ADD CONSTRAINT creator_account_links_source_verification_fk
  FOREIGN KEY (source_verification_id)
  REFERENCES workflow.verification_requests(verification_id) NOT VALID;

ALTER TABLE catalog.author_relations
  ADD CONSTRAINT author_relations_source_verification_fk
  FOREIGN KEY (source_verification_id)
  REFERENCES workflow.verification_requests(verification_id) NOT VALID;

CREATE OR REPLACE FUNCTION catalog.validate_author_relation_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  creator_is_canonical boolean;
  source_exists boolean;
  approved_link_valid boolean;
BEGIN
  SELECT canonical_creator_id IS NULL AND merge_status='canonical'
    INTO creator_is_canonical
    FROM catalog.creators WHERE creator_id=NEW.creator_id;
  IF creator_is_canonical IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'AUTHOR_RELATION_CREATOR_NOT_CANONICAL' USING ERRCODE='23514';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM workflow.verification_requests request
    WHERE request.verification_id=NEW.source_verification_id
  ) INTO source_exists;
  IF source_exists THEN
    SELECT EXISTS (
      SELECT 1 FROM catalog.creator_account_links link
      JOIN workflow.verification_requests request
        ON request.verification_id=NEW.source_verification_id
      WHERE link.creator_account_link_id=NEW.approved_via_creator_account_link_id
        AND link.creator_id=NEW.creator_id
        AND link.user_id=request.applicant_user_id
        AND link.status='active'
    ) INTO approved_link_valid;
    IF approved_link_valid IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'AUTHOR_RELATION_APPROVED_LINK_INVALID' USING ERRCODE='23514';
    END IF;
  END IF;

  IF TG_OP='UPDATE' THEN
    IF NEW.project_id<>OLD.project_id OR NEW.creator_id<>OLD.creator_id
       OR NEW.author_role<>OLD.author_role
       OR NEW.field_permissions_json<>OLD.field_permissions_json
       OR NEW.source_verification_id<>OLD.source_verification_id
       OR NEW.approved_via_creator_account_link_id IS DISTINCT FROM OLD.approved_via_creator_account_link_id
       OR NEW.created_at<>OLD.created_at THEN
      RAISE EXCEPTION 'AUTHOR_RELATION_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
    END IF;
    IF NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at THEN
      RAISE EXCEPTION 'AUTHOR_RELATION_VERSION_INVALID' USING ERRCODE='23514';
    END IF;
    IF NOT (
      (OLD.status='active' AND NEW.status IN ('active','suspended','terminated','replaced')) OR
      (OLD.status='suspended' AND NEW.status IN ('active','suspended','terminated','replaced')) OR
      (OLD.status IN ('terminated','replaced') AND NEW.status=OLD.status)
    ) THEN
      RAISE EXCEPTION 'AUTHOR_RELATION_TRANSITION_INVALID' USING ERRCODE='23514';
    END IF;
    IF OLD.status IN ('terminated','replaced') AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'AUTHOR_RELATION_TERMINAL_IMMUTABLE' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER author_relations_validate_v1
  BEFORE INSERT OR UPDATE ON catalog.author_relations
  FOR EACH ROW EXECUTE FUNCTION catalog.validate_author_relation_v1();

CREATE TRIGGER author_relations_no_delete
  BEFORE DELETE ON catalog.author_relations
  FOR EACH ROW EXECUTE FUNCTION catalog.reject_immutable_mutation();

CREATE TABLE IF NOT EXISTS private_material.material_read_grants (
  grant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id uuid NOT NULL REFERENCES private_material.verification_materials(material_id),
  reviewer_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  primary_session_id_hash bytea NOT NULL,
  work_item_id uuid NOT NULL REFERENCES workflow.review_work_items(work_item_id),
  claim_token_hash bytea NOT NULL,
  purpose varchar(64) NOT NULL CHECK (purpose='author_verification_review'),
  operation_id varchar(128) NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE (reviewer_user_id,material_id,operation_id),
  CHECK (expires_at>created_at AND expires_at<=created_at+interval '5 minutes'),
  CHECK (consumed_at IS NULL OR consumed_at>=created_at),
  CHECK (invalidated_at IS NULL OR invalidated_at>=created_at),
  CHECK (consumed_at IS NULL OR invalidated_at IS NULL)
);

CREATE INDEX IF NOT EXISTS material_read_grants_active_idx
  ON private_material.material_read_grants (material_id,expires_at)
  WHERE consumed_at IS NULL AND invalidated_at IS NULL;

CREATE OR REPLACE FUNCTION private_material.validate_material_read_grant_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.grant_id<>OLD.grant_id OR NEW.material_id<>OLD.material_id
     OR NEW.reviewer_user_id<>OLD.reviewer_user_id
     OR NEW.primary_session_id_hash<>OLD.primary_session_id_hash
     OR NEW.work_item_id<>OLD.work_item_id OR NEW.claim_token_hash<>OLD.claim_token_hash
     OR NEW.purpose<>OLD.purpose OR NEW.operation_id<>OLD.operation_id
     OR NEW.request_hash<>OLD.request_hash OR NEW.token_hash<>OLD.token_hash
     OR NEW.expires_at<>OLD.expires_at OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'MATERIAL_READ_GRANT_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF OLD.consumed_at IS NOT NULL OR OLD.invalidated_at IS NOT NULL THEN
    RAISE EXCEPTION 'MATERIAL_READ_GRANT_TERMINAL_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF (NEW.consumed_at IS NULL)=(NEW.invalidated_at IS NULL) THEN
    RAISE EXCEPTION 'MATERIAL_READ_GRANT_TRANSITION_INVALID' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER material_read_grants_validate
  BEFORE UPDATE ON private_material.material_read_grants
  FOR EACH ROW EXECUTE FUNCTION private_material.validate_material_read_grant_mutation();

CREATE TRIGGER material_read_grants_no_delete
  BEFORE DELETE ON private_material.material_read_grants
  FOR EACH ROW EXECUTE FUNCTION catalog.reject_immutable_mutation();

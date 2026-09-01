CREATE TABLE IF NOT EXISTS private_material.verification_materials (
  material_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id uuid NOT NULL REFERENCES workflow.verification_requests(verification_id),
  owner_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  storage_key_ciphertext bytea NOT NULL,
  storage_key_nonce bytea NOT NULL,
  storage_key_auth_tag bytea NOT NULL,
  storage_key_version varchar(64) NOT NULL,
  declared_mime varchar(64) NOT NULL CHECK (declared_mime IN (
    'application/pdf','image/jpeg','image/png'
  )),
  detected_mime varchar(64),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  checksum_sha256 char(64) NOT NULL CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  upload_receipt_hash char(64),
  status varchar(24) NOT NULL DEFAULT 'prepared' CHECK (status IN (
    'prepared','uploaded','scanning','ready','abandoned','rejected','revoked','deleted'
  )),
  scan_result varchar(24) NOT NULL DEFAULT 'not_scanned' CHECK (scan_result IN (
    'not_scanned','clean','malicious','unscannable'
  )),
  rejection_reason_code varchar(64),
  pre_terminal_scan_result varchar(24) CHECK (pre_terminal_scan_result IN (
    'not_scanned','clean','malicious','unscannable'
  )),
  applicant_terminal_state_json jsonb,
  scan_attempt_count integer NOT NULL DEFAULT 0 CHECK (scan_attempt_count BETWEEN 0 AND 3),
  next_scan_at timestamptz,
  scan_queued_at timestamptz,
  read_grant_count integer NOT NULL DEFAULT 0 CHECK (read_grant_count >= 0),
  last_read_at timestamptz,
  legal_hold boolean NOT NULL DEFAULT false,
  content_retention_until timestamptz,
  idempotency_key varchar(128) NOT NULL,
  request_hash char(64) NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  upload_expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  processing_deadline_at timestamptz,
  revoked_at timestamptz,
  deleted_at timestamptz,
  CHECK (octet_length(storage_key_nonce)=12),
  CHECK (octet_length(storage_key_auth_tag)=16),
  CHECK (upload_expires_at=created_at+interval '30 minutes'),
  CHECK (updated_at>=created_at),
  CHECK (applicant_terminal_state_json IS NULL OR jsonb_typeof(applicant_terminal_state_json)='object'),
  CHECK (
    (status IN ('prepared','uploaded','scanning','abandoned') AND scan_result='not_scanned') OR
    (status='ready' AND scan_result='clean') OR
    (status='rejected' AND scan_result IN ('not_scanned','malicious','unscannable')) OR
    (status IN ('revoked','deleted') AND pre_terminal_scan_result=scan_result)
  ),
  CHECK ((status='prepared' AND completed_at IS NULL AND processing_deadline_at IS NULL) OR status<>'prepared'),
  CHECK ((status IN ('uploaded','scanning','ready','rejected') AND completed_at IS NOT NULL) OR status NOT IN ('uploaded','scanning','ready','rejected')),
  CHECK ((completed_at IS NULL AND processing_deadline_at IS NULL) OR processing_deadline_at=completed_at+interval '30 minutes'),
  CHECK (status<>'revoked' OR revoked_at IS NOT NULL),
  CHECK ((status='deleted')=(deleted_at IS NOT NULL))
);

CREATE UNIQUE INDEX verification_material_prepare_idempotency_uniq
  ON private_material.verification_materials (owner_user_id,idempotency_key);

CREATE INDEX verification_material_owner_request_idx
  ON private_material.verification_materials (owner_user_id,verification_id,created_at,material_id);

CREATE INDEX verification_material_scan_queue_idx
  ON private_material.verification_materials (status,next_scan_at,scan_queued_at)
  WHERE status IN ('uploaded','scanning');

CREATE TABLE IF NOT EXISTS private_material.verification_material_operations (
  material_id uuid NOT NULL REFERENCES private_material.verification_materials(material_id),
  owner_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  operation_id varchar(128) NOT NULL,
  operation_type varchar(16) NOT NULL CHECK (operation_type IN ('complete','revoke')),
  request_hash char(64) NOT NULL,
  resulting_version bigint NOT NULL CHECK (resulting_version>=1),
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (material_id,owner_user_id,operation_id),
  CHECK (jsonb_typeof(response_json)='object')
);

CREATE TABLE IF NOT EXISTS private_material.material_access_logs (
  access_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id uuid NOT NULL REFERENCES private_material.verification_materials(material_id),
  actor_user_id uuid REFERENCES iam.users(user_id),
  work_item_id uuid REFERENCES workflow.review_work_items(work_item_id),
  action varchar(32) NOT NULL CHECK (action IN (
    'prepare','self_read','complete','revoke','scan_claim','scan_result','read_grant','content_read','delete'
  )),
  purpose varchar(64) NOT NULL,
  result varchar(32) NOT NULL,
  request_id varchar(128) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX material_access_log_target_idx
  ON private_material.material_access_logs (material_id,occurred_at DESC,access_id);

CREATE OR REPLACE FUNCTION private_material.validate_verification_material_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.verification_id<>OLD.verification_id OR NEW.owner_user_id<>OLD.owner_user_id
     OR NEW.storage_key_ciphertext<>OLD.storage_key_ciphertext
     OR NEW.storage_key_nonce<>OLD.storage_key_nonce
     OR NEW.storage_key_auth_tag<>OLD.storage_key_auth_tag
     OR NEW.storage_key_version<>OLD.storage_key_version
     OR NEW.declared_mime<>OLD.declared_mime OR NEW.byte_size<>OLD.byte_size
     OR NEW.checksum_sha256<>OLD.checksum_sha256 OR NEW.idempotency_key<>OLD.idempotency_key
     OR NEW.request_hash<>OLD.request_hash OR NEW.created_at<>OLD.created_at
     OR NEW.upload_expires_at<>OLD.upload_expires_at THEN
    RAISE EXCEPTION 'VERIFICATION_MATERIAL_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at THEN
    RAISE EXCEPTION 'VERIFICATION_MATERIAL_VERSION_INVALID' USING ERRCODE='23514';
  END IF;
  IF OLD.status='deleted' THEN
    RAISE EXCEPTION 'VERIFICATION_MATERIAL_DELETED_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF NOT (
    (OLD.status='prepared' AND NEW.status IN ('uploaded','abandoned','rejected','revoked')) OR
    (OLD.status='uploaded' AND NEW.status IN ('uploaded','scanning','rejected','revoked')) OR
    (OLD.status='scanning' AND NEW.status IN ('uploaded','ready','rejected','revoked')) OR
    (OLD.status IN ('ready','abandoned','rejected') AND NEW.status IN ('revoked','deleted')) OR
    (OLD.status='revoked' AND NEW.status IN ('revoked','deleted'))
  ) THEN
    RAISE EXCEPTION 'VERIFICATION_MATERIAL_TRANSITION_INVALID' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER verification_materials_validate_mutation
  BEFORE UPDATE ON private_material.verification_materials
  FOR EACH ROW EXECUTE FUNCTION private_material.validate_verification_material_mutation();

CREATE TRIGGER verification_materials_no_delete
  BEFORE DELETE ON private_material.verification_materials
  FOR EACH ROW EXECUTE FUNCTION catalog.reject_immutable_mutation();

CREATE TRIGGER verification_material_operations_immutable
  BEFORE UPDATE OR DELETE ON private_material.verification_material_operations
  FOR EACH ROW EXECUTE FUNCTION catalog.reject_immutable_mutation();

CREATE TRIGGER material_access_logs_immutable
  BEFORE UPDATE OR DELETE ON private_material.material_access_logs
  FOR EACH ROW EXECUTE FUNCTION catalog.reject_immutable_mutation();

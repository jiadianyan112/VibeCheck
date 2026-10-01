CREATE TABLE IF NOT EXISTS workflow.admin_project_import_batches (
  import_batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name varchar(64) NOT NULL,
  batch_key varchar(128) NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  input_digest char(64) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'completed_with_errors')),
  item_count integer NOT NULL CHECK (item_count BETWEEN 1 AND 500),
  accepted_count integer NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  rejected_count integer NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  request_id varchar(64) NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (source_name, batch_key),
  CHECK (accepted_count + rejected_count <= item_count),
  CHECK (
    (status = 'running' AND completed_at IS NULL)
    OR (status IN ('completed', 'completed_with_errors') AND completed_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS workflow.admin_project_creation_drafts (
  admin_creation_draft_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_editor_id uuid NOT NULL REFERENCES iam.users(user_id),
  category_id varchar(64) NOT NULL,
  category_schema_version varchar(32) NOT NULL,
  snapshot_json jsonb NOT NULL,
  canonical_public_url varchar(2048) NOT NULL,
  canonical_url_hash bytea NOT NULL,
  duplicate_candidates_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason_code varchar(64) NOT NULL,
  source_kind varchar(32) NOT NULL
    CHECK (source_kind IN ('admin_manual', 'catalog_import')),
  import_source varchar(64),
  source_record_key varchar(128),
  import_request_hash char(64),
  status varchar(32) NOT NULL DEFAULT 'editing'
    CHECK (status IN ('editing', 'submitted', 'withdrawn', 'expired')),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (category_id, category_schema_version)
    REFERENCES taxonomy.category_schema_versions(category_id, schema_version),
  CHECK (jsonb_typeof(snapshot_json) = 'object'),
  CHECK (jsonb_typeof(duplicate_candidates_json) = 'array'),
  CHECK (
    (source_kind = 'catalog_import' AND import_source IS NOT NULL
      AND source_record_key IS NOT NULL AND import_request_hash IS NOT NULL)
    OR (source_kind = 'admin_manual' AND import_source IS NULL
      AND source_record_key IS NULL AND import_request_hash IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_creation_drafts_import_source_uniq
  ON workflow.admin_project_creation_drafts (import_source, source_record_key)
  WHERE source_kind = 'catalog_import';

CREATE INDEX IF NOT EXISTS admin_creation_drafts_owner_status_idx
  ON workflow.admin_project_creation_drafts (owner_editor_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS admin_creation_drafts_url_idx
  ON workflow.admin_project_creation_drafts (canonical_url_hash, status);

CREATE TABLE IF NOT EXISTS workflow.admin_project_import_receipts (
  import_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id uuid NOT NULL REFERENCES workflow.admin_project_import_batches(import_batch_id),
  source_name varchar(64) NOT NULL,
  source_record_key varchar(128) NOT NULL,
  request_hash char(64) NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('accepted', 'rejected')),
  admin_creation_draft_id uuid REFERENCES workflow.admin_project_creation_drafts(admin_creation_draft_id),
  error_code varchar(64),
  result_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_batch_id, source_record_key),
  CHECK (jsonb_typeof(result_json) = 'object'),
  CHECK (
    (status = 'accepted' AND admin_creation_draft_id IS NOT NULL AND error_code IS NULL)
    OR (status = 'rejected' AND admin_creation_draft_id IS NULL AND error_code IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS admin_project_import_receipts_batch_idx
  ON workflow.admin_project_import_receipts (import_batch_id, created_at, import_item_id);

CREATE OR REPLACE FUNCTION workflow.reject_immutable_import_receipt_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_IMPORT_RECEIPT' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS admin_project_import_receipts_immutable
  ON workflow.admin_project_import_receipts;
CREATE TRIGGER admin_project_import_receipts_immutable
  BEFORE UPDATE OR DELETE ON workflow.admin_project_import_receipts
  FOR EACH ROW EXECUTE FUNCTION workflow.reject_immutable_import_receipt_mutation();

CREATE OR REPLACE FUNCTION audit.reject_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_AUDIT_LOG' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_immutable ON audit.audit_logs;
CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit.audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit.reject_audit_log_mutation();

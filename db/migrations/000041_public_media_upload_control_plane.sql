ALTER TABLE media.media_resources
  ADD COLUMN IF NOT EXISTS upload_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_deadline_at timestamptz;

CREATE INDEX IF NOT EXISTS media_resources_upload_expiry_idx
  ON media.media_resources (upload_expires_at,media_resource_id)
  WHERE status='uploading';

CREATE INDEX IF NOT EXISTS media_resources_processing_deadline_idx
  ON media.media_resources (processing_deadline_at,media_resource_id)
  WHERE status IN ('uploaded','scanning','processing');

CREATE TABLE IF NOT EXISTS media.media_resource_operation_receipts (
  owner_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  media_resource_id uuid NOT NULL REFERENCES media.media_resources(media_resource_id),
  operation_id varchar(128) NOT NULL,
  operation_type varchar(16) NOT NULL CHECK (operation_type IN ('complete')),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  upload_receipt_hash char(64) NOT NULL CHECK (upload_receipt_hash ~ '^[a-f0-9]{64}$'),
  response_json jsonb NOT NULL CHECK (jsonb_typeof(response_json)='object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_user_id,media_resource_id,operation_id)
);

CREATE OR REPLACE FUNCTION media.reject_media_resource_receipt_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'MEDIA_RESOURCE_RECEIPT_IMMUTABLE' USING ERRCODE='55000';
END;
$$;

DROP TRIGGER IF EXISTS media_resource_receipt_immutable
  ON media.media_resource_operation_receipts;
CREATE TRIGGER media_resource_receipt_immutable
  BEFORE UPDATE OR DELETE ON media.media_resource_operation_receipts
  FOR EACH ROW EXECUTE FUNCTION media.reject_media_resource_receipt_mutation();

CREATE OR REPLACE FUNCTION media.guard_media_resource_upload_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR
     NEW.purpose IS DISTINCT FROM OLD.purpose OR
     NEW.declared_mime IS DISTINCT FROM OLD.declared_mime OR
     NEW.byte_size IS DISTINCT FROM OLD.byte_size OR
     NEW.checksum_sha256 IS DISTINCT FROM OLD.checksum_sha256 OR
     NEW.source IS DISTINCT FROM OLD.source OR
     NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR
     NEW.request_hash IS DISTINCT FROM OLD.request_hash OR
     NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'MEDIA_RESOURCE_UPLOAD_IDENTITY_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  IF (OLD.status='deleted' AND NEW.status IS DISTINCT FROM OLD.status) OR
     (OLD.status IN ('ready','rejected') AND NEW.status NOT IN (OLD.status,'deleted')) THEN
    RAISE EXCEPTION 'MEDIA_RESOURCE_TERMINAL_STATE_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF OLD.status='uploading' AND NEW.status NOT IN ('uploading','uploaded','rejected','deleted') THEN
    RAISE EXCEPTION 'MEDIA_RESOURCE_UPLOAD_TRANSITION_INVALID' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS media_resource_upload_state_guard ON media.media_resources;
CREATE TRIGGER media_resource_upload_state_guard
  BEFORE UPDATE ON media.media_resources
  FOR EACH ROW EXECUTE FUNCTION media.guard_media_resource_upload_state();

ALTER TABLE workflow.submissions
  ADD COLUMN IF NOT EXISTS media_reference_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS preview_hash char(64);

UPDATE workflow.submissions
SET preview_hash = encode(digest(
  submission_id::text || ':' || snapshot_version::text || ':' || payload_snapshot::text,
  'sha256'
), 'hex')
WHERE preview_hash IS NULL;

ALTER TABLE workflow.submissions
  ALTER COLUMN preview_hash SET NOT NULL,
  ADD CONSTRAINT submissions_media_reference_ids_shape CHECK (
    jsonb_typeof(media_reference_ids_json) = 'array'
    AND jsonb_array_length(media_reference_ids_json) BETWEEN 0 AND 20
  ) NOT VALID,
  ADD CONSTRAINT submissions_preview_hash_shape CHECK (
    preview_hash ~ '^[a-f0-9]{64}$'
  ) NOT VALID;

ALTER TABLE workflow.submissions VALIDATE CONSTRAINT submissions_media_reference_ids_shape;
ALTER TABLE workflow.submissions VALIDATE CONSTRAINT submissions_preview_hash_shape;

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
    NEW.media_reference_ids_json IS DISTINCT FROM OLD.media_reference_ids_json OR
    NEW.preview_hash IS DISTINCT FROM OLD.preview_hash OR
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

CREATE TABLE IF NOT EXISTS workflow.submission_preview_audits (
  preview_audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES workflow.submission_drafts(draft_id),
  owner_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  draft_version integer NOT NULL CHECK (draft_version >= 1),
  check_id uuid NOT NULL REFERENCES workflow.submission_url_checks(check_id),
  preview_hash char(64) NOT NULL CHECK (preview_hash ~ '^[a-f0-9]{64}$'),
  validation_hash char(64) NOT NULL CHECK (validation_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS submission_preview_audits_draft_idx
  ON workflow.submission_preview_audits (draft_id, created_at DESC, preview_audit_id DESC);

CREATE OR REPLACE FUNCTION workflow.reject_submission_preview_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'SUBMISSION_PREVIEW_AUDIT_IMMUTABLE' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS submission_preview_audit_immutable ON workflow.submission_preview_audits;
CREATE TRIGGER submission_preview_audit_immutable
  BEFORE UPDATE OR DELETE ON workflow.submission_preview_audits
  FOR EACH ROW EXECUTE FUNCTION workflow.reject_submission_preview_audit_mutation();

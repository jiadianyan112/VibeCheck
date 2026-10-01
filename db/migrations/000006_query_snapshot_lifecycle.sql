ALTER TABLE iam.identity_links
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

CREATE INDEX IF NOT EXISTS identity_links_user_status_idx
  ON iam.identity_links (user_id, status, expires_at DESC);

ALTER TABLE search.query_authorized_subjects
  ADD CONSTRAINT query_authorized_subjects_identity_link_fk
  FOREIGN KEY (identity_link_id) REFERENCES iam.identity_links(identity_link_id);

CREATE TABLE IF NOT EXISTS search.query_operation_receipts (
  query_id uuid NOT NULL REFERENCES search.query_snapshots(query_id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  operation_type varchar(16) NOT NULL
    CHECK (operation_type IN ('link', 'unlink', 'invalidate')),
  subject_hash bytea NOT NULL CHECK (octet_length(subject_hash) = 32),
  request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
  response_json jsonb NOT NULL CHECK (jsonb_typeof(response_json) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (query_id, operation_id, subject_hash)
);

ALTER TABLE search.query_snapshots
  ALTER COLUMN encrypted_data_key DROP NOT NULL,
  ALTER COLUMN data_key_iv DROP NOT NULL,
  ALTER COLUMN data_key_auth_tag DROP NOT NULL,
  ALTER COLUMN raw_query_ciphertext DROP NOT NULL,
  ALTER COLUMN raw_query_iv DROP NOT NULL,
  ALTER COLUMN raw_query_auth_tag DROP NOT NULL;

CREATE OR REPLACE FUNCTION search.protect_query_snapshot_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cryptographic_erasure boolean;
BEGIN
  cryptographic_erasure :=
    OLD.status = 'active'
    AND NEW.status = 'invalidated'
    AND NEW.encrypted_data_key IS NULL
    AND NEW.data_key_iv IS NULL
    AND NEW.data_key_auth_tag IS NULL
    AND NEW.raw_query_ciphertext IS NULL
    AND NEW.raw_query_iv IS NULL
    AND NEW.raw_query_auth_tag IS NULL;

  IF NEW.owner_subject_kind IS DISTINCT FROM OLD.owner_subject_kind
     OR NEW.owner_subject_hash IS DISTINCT FROM OLD.owner_subject_hash
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.encryption_key_version IS DISTINCT FROM OLD.encryption_key_version
     OR NEW.query_hash IS DISTINCT FROM OLD.query_hash THEN
    RAISE EXCEPTION 'QUERY_SNAPSHOT_IMMUTABLE_FIELD';
  END IF;

  IF (
    NEW.encrypted_data_key IS DISTINCT FROM OLD.encrypted_data_key
    OR NEW.data_key_iv IS DISTINCT FROM OLD.data_key_iv
    OR NEW.data_key_auth_tag IS DISTINCT FROM OLD.data_key_auth_tag
    OR NEW.raw_query_ciphertext IS DISTINCT FROM OLD.raw_query_ciphertext
    OR NEW.raw_query_iv IS DISTINCT FROM OLD.raw_query_iv
    OR NEW.raw_query_auth_tag IS DISTINCT FROM OLD.raw_query_auth_tag
  ) AND NOT cryptographic_erasure THEN
    RAISE EXCEPTION 'QUERY_SNAPSHOT_CIPHERTEXT_IMMUTABLE';
  END IF;

  IF OLD.status = 'invalidated' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'QUERY_SNAPSHOT_TERMINAL';
  END IF;
  IF NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at AND NOT cryptographic_erasure THEN
    RAISE EXCEPTION 'QUERY_SNAPSHOT_INVALIDATION_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE search.query_snapshots
  ADD CONSTRAINT query_snapshots_ciphertext_lifecycle_check
  CHECK (
    (
      status = 'active'
      AND encrypted_data_key IS NOT NULL
      AND data_key_iv IS NOT NULL
      AND data_key_auth_tag IS NOT NULL
      AND raw_query_ciphertext IS NOT NULL
      AND raw_query_iv IS NOT NULL
      AND raw_query_auth_tag IS NOT NULL
    )
    OR (
      status = 'invalidated'
      AND encrypted_data_key IS NULL
      AND data_key_iv IS NULL
      AND data_key_auth_tag IS NULL
      AND raw_query_ciphertext IS NULL
      AND raw_query_iv IS NULL
      AND raw_query_auth_tag IS NULL
    )
  );

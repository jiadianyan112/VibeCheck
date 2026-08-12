CREATE TABLE IF NOT EXISTS iam.pending_actions (
  pending_action_id uuid PRIMARY KEY,
  owner_user_id uuid REFERENCES iam.users(user_id),
  anonymous_subject_hash bytea,
  action_type varchar(32) NOT NULL
    CHECK (action_type IN (
      'set_project_favorite','set_project_like','set_project_follow',
      'create_comment','save_comparison','start_submission'
    )),
  payload_ciphertext bytea,
  payload_key_version varchar(128) NOT NULL,
  request_payload_hash char(64) NOT NULL CHECK (request_payload_hash ~ '^[a-f0-9]{64}$'),
  return_to varchar(2048) NOT NULL,
  client_request_id uuid NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','consumed','cancelled','expired')),
  execution_receipt_hash bytea,
  consumed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason varchar(128),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_user_id IS NOT NULL) <> (anonymous_subject_hash IS NOT NULL)),
  CHECK (anonymous_subject_hash IS NULL OR octet_length(anonymous_subject_hash) = 32),
  CHECK (expires_at > created_at),
  CHECK (updated_at >= created_at),
  CHECK (
    (status='pending' AND payload_ciphertext IS NOT NULL AND consumed_at IS NULL AND cancelled_at IS NULL)
    OR (status='consumed' AND payload_ciphertext IS NULL AND consumed_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status='cancelled' AND payload_ciphertext IS NULL AND consumed_at IS NULL AND cancelled_at IS NOT NULL)
    OR (status='expired' AND payload_ciphertext IS NULL AND consumed_at IS NULL AND cancelled_at IS NULL)
  ),
  CHECK (
    (status='consumed' AND execution_receipt_hash IS NOT NULL
      AND octet_length(execution_receipt_hash)=32)
    OR (status<>'consumed' AND execution_receipt_hash IS NULL)
  ),
  CHECK (
    (status='cancelled' AND cancel_reason IS NOT NULL)
    OR (status<>'cancelled' AND cancel_reason IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS pending_actions_user_request_uniq
  ON iam.pending_actions (owner_user_id,client_request_id)
  WHERE owner_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pending_actions_anonymous_request_uniq
  ON iam.pending_actions (anonymous_subject_hash,client_request_id)
  WHERE anonymous_subject_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pending_actions_user_active_uniq
  ON iam.pending_actions (owner_user_id)
  WHERE owner_user_id IS NOT NULL AND status='pending';

CREATE UNIQUE INDEX IF NOT EXISTS pending_actions_anonymous_active_uniq
  ON iam.pending_actions (anonymous_subject_hash)
  WHERE anonymous_subject_hash IS NOT NULL AND status='pending';

CREATE INDEX IF NOT EXISTS pending_actions_expiry_idx
  ON iam.pending_actions (expires_at)
  WHERE status='pending';

CREATE TABLE IF NOT EXISTS iam.pending_action_operation_receipts (
  pending_action_id uuid NOT NULL REFERENCES iam.pending_actions(pending_action_id),
  operation_id uuid NOT NULL,
  operation_type varchar(16) NOT NULL CHECK (operation_type IN ('consume','cancel')),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pending_action_id,operation_id),
  CHECK (jsonb_typeof(response_json)='object')
);

CREATE TABLE IF NOT EXISTS iam.pending_action_identity_links (
  pending_action_id uuid NOT NULL REFERENCES iam.pending_actions(pending_action_id),
  identity_link_id uuid NOT NULL UNIQUE REFERENCES iam.identity_links(identity_link_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pending_action_id,identity_link_id)
);

ALTER TABLE iam.auth_email_challenges
  ADD COLUMN IF NOT EXISTS pending_action_id uuid REFERENCES iam.pending_actions(pending_action_id);

CREATE INDEX IF NOT EXISTS auth_email_challenges_pending_action_idx
  ON iam.auth_email_challenges (pending_action_id)
  WHERE pending_action_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='comparison_merge_conflicts_pending_action_fk'
      AND conrelid='comparison.comparison_merge_conflicts'::regclass
  ) THEN
    ALTER TABLE comparison.comparison_merge_conflicts
      ADD CONSTRAINT comparison_merge_conflicts_pending_action_fk
      FOREIGN KEY (pending_action_id) REFERENCES iam.pending_actions(pending_action_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION iam.guard_pending_action_terminal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'IMMUTABLE_PENDING_ACTION' USING ERRCODE='55000';
  END IF;
  IF OLD.pending_action_id IS DISTINCT FROM NEW.pending_action_id
     OR OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id
     OR OLD.anonymous_subject_hash IS DISTINCT FROM NEW.anonymous_subject_hash
     OR OLD.action_type IS DISTINCT FROM NEW.action_type
     OR OLD.payload_key_version IS DISTINCT FROM NEW.payload_key_version
     OR OLD.request_payload_hash IS DISTINCT FROM NEW.request_payload_hash
     OR OLD.return_to IS DISTINCT FROM NEW.return_to
     OR OLD.client_request_id IS DISTINCT FROM NEW.client_request_id
     OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR (NEW.status='pending' AND OLD.payload_ciphertext IS DISTINCT FROM NEW.payload_ciphertext)
     OR OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'IMMUTABLE_PENDING_ACTION' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pending_actions_guard ON iam.pending_actions;
CREATE TRIGGER pending_actions_guard
  BEFORE UPDATE OR DELETE ON iam.pending_actions
  FOR EACH ROW EXECUTE FUNCTION iam.guard_pending_action_terminal();

CREATE OR REPLACE FUNCTION iam.guard_pending_action_receipt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_PENDING_ACTION_RECEIPT' USING ERRCODE='55000';
END;
$$;

DROP TRIGGER IF EXISTS pending_action_receipts_guard
  ON iam.pending_action_operation_receipts;
CREATE TRIGGER pending_action_receipts_guard
  BEFORE UPDATE OR DELETE ON iam.pending_action_operation_receipts
  FOR EACH ROW EXECUTE FUNCTION iam.guard_pending_action_receipt();

CREATE OR REPLACE FUNCTION iam.guard_pending_action_identity_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  link_purpose varchar(32);
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'IMMUTABLE_PENDING_ACTION_IDENTITY_LINK' USING ERRCODE='55000';
  END IF;
  SELECT purpose INTO link_purpose
  FROM iam.identity_links WHERE identity_link_id=NEW.identity_link_id;
  IF link_purpose IS DISTINCT FROM 'pending_action_replay' THEN
    RAISE EXCEPTION 'PENDING_ACTION_IDENTITY_LINK_PURPOSE_INVALID' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pending_action_identity_links_guard
  ON iam.pending_action_identity_links;
CREATE TRIGGER pending_action_identity_links_guard
  BEFORE INSERT OR UPDATE OR DELETE ON iam.pending_action_identity_links
  FOR EACH ROW EXECUTE FUNCTION iam.guard_pending_action_identity_link();

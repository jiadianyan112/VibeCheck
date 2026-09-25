ALTER TABLE iam.admin_reauth_grants
  ADD COLUMN IF NOT EXISTS auth_flow_id uuid,
  ADD COLUMN IF NOT EXISTS recent_auth_at timestamptz;

UPDATE iam.admin_reauth_grants
SET auth_flow_id = COALESCE(auth_flow_id,gen_random_uuid()),
    recent_auth_at = COALESCE(recent_auth_at,issued_at)
WHERE auth_flow_id IS NULL OR recent_auth_at IS NULL;

ALTER TABLE iam.admin_reauth_grants
  ALTER COLUMN auth_flow_id SET NOT NULL,
  ALTER COLUMN recent_auth_at SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS admin_reauth_grants_auth_flow_uniq
  ON iam.admin_reauth_grants (auth_flow_id);

CREATE TABLE IF NOT EXISTS workflow.admin_operation_previews (
  preview_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preview_token_hash bytea NOT NULL UNIQUE,
  actor_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  primary_session_id_hash bytea NOT NULL REFERENCES iam.sessions(session_id_hash),
  roles_version bigint NOT NULL CHECK (roles_version >= 1),
  operation_type varchar(64) NOT NULL,
  targets_json jsonb NOT NULL,
  expected_versions_json jsonb NOT NULL,
  proposed_diff_json jsonb NOT NULL,
  reason_code varchar(64) NOT NULL,
  claim_token_hash bytea,
  expected_conflict_principal_version integer,
  diff_hash char(64) NOT NULL,
  impact_hash char(64) NOT NULL,
  confirmation_summary_hash char(64) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','reauth_required','consumed','expired','revoked')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  challenged_at timestamptz,
  consumed_at timestamptz,
  revoked_at timestamptz,
  CHECK (operation_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  CHECK (jsonb_typeof(targets_json) = 'array'),
  CHECK (jsonb_typeof(expected_versions_json) = 'object'),
  CHECK (jsonb_typeof(proposed_diff_json) = 'object'),
  CHECK (diff_hash ~ '^[a-f0-9]{64}$'),
  CHECK (impact_hash ~ '^[a-f0-9]{64}$'),
  CHECK (confirmation_summary_hash ~ '^[a-f0-9]{64}$'),
  CHECK (expected_conflict_principal_version IS NULL OR expected_conflict_principal_version >= 1),
  CHECK (expires_at > created_at),
  CHECK (status <> 'reauth_required' OR challenged_at IS NOT NULL),
  CHECK ((status = 'consumed') = (consumed_at IS NOT NULL)),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS admin_operation_previews_actor_status_idx
  ON workflow.admin_operation_previews (
    actor_user_id,primary_session_id_hash,status,expires_at DESC
  );

CREATE TABLE IF NOT EXISTS workflow.admin_operation_confirm_grants (
  confirm_grant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preview_id uuid NOT NULL REFERENCES workflow.admin_operation_previews(preview_id),
  confirm_token_hash bytea NOT NULL UNIQUE,
  confirm_request_id varchar(64) NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  primary_session_id_hash bytea NOT NULL REFERENCES iam.sessions(session_id_hash),
  roles_version bigint NOT NULL CHECK (roles_version >= 1),
  reauth_grant_id uuid REFERENCES iam.admin_reauth_grants(reauth_grant_id),
  assurance_source varchar(32) NOT NULL
    CHECK (assurance_source IN ('recent_session','step_up_grant')),
  confirmation_summary_hash char(64) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','consumed','expired','revoked')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  CHECK (confirm_request_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  CHECK (confirmation_summary_hash ~ '^[a-f0-9]{64}$'),
  CHECK (expires_at > created_at),
  CHECK ((status = 'consumed') = (consumed_at IS NOT NULL)),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  UNIQUE (primary_session_id_hash,preview_id,confirm_request_id)
);

CREATE INDEX IF NOT EXISTS admin_operation_confirm_grants_status_idx
  ON workflow.admin_operation_confirm_grants (
    actor_user_id,primary_session_id_hash,status,expires_at DESC
  );

CREATE TABLE IF NOT EXISTS workflow.admin_operation_security_events (
  security_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preview_id uuid NOT NULL REFERENCES workflow.admin_operation_previews(preview_id),
  confirm_grant_id uuid REFERENCES workflow.admin_operation_confirm_grants(confirm_grant_id),
  actor_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  event_type varchar(32) NOT NULL CHECK (event_type IN (
    'preview_issued','preview_challenged','confirm_issued','confirm_replayed',
    'confirm_consumed','preview_revoked','confirm_revoked'
  )),
  request_id varchar(64) NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  CHECK (request_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  CHECK (jsonb_typeof(metadata_json) = 'object')
);

CREATE INDEX IF NOT EXISTS admin_operation_security_events_preview_idx
  ON workflow.admin_operation_security_events (preview_id,occurred_at,security_event_id);

CREATE OR REPLACE FUNCTION workflow.reject_admin_operation_security_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_ADMIN_OPERATION_SECURITY_EVENT' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS admin_operation_security_event_immutable
  ON workflow.admin_operation_security_events;
CREATE TRIGGER admin_operation_security_event_immutable
  BEFORE UPDATE OR DELETE ON workflow.admin_operation_security_events
  FOR EACH ROW EXECUTE FUNCTION workflow.reject_admin_operation_security_event_mutation();

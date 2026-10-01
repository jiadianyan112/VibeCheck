CREATE TABLE IF NOT EXISTS iam.user_roles (
  user_role_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES iam.users(user_id),
  role varchar(32) NOT NULL
    CHECK (role IN ('user', 'verified_author', 'editor', 'admin')),
  granted_by_operation_id varchar(64) NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_active_role_uniq
  ON iam.user_roles (user_id, role)
  WHERE valid_to IS NULL;

ALTER TABLE iam.sessions
  ADD COLUMN IF NOT EXISTS csrf_token_hash bytea,
  ADD COLUMN IF NOT EXISTS session_version bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS auth_method varchar(32) NOT NULL DEFAULT 'email_otp',
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS ip_hash bytea,
  ADD COLUMN IF NOT EXISTS user_agent_hash bytea;

UPDATE iam.sessions
SET csrf_token_hash = digest(gen_random_uuid()::text, 'sha256')
WHERE csrf_token_hash IS NULL;

ALTER TABLE iam.sessions
  ALTER COLUMN csrf_token_hash SET NOT NULL;

CREATE INDEX IF NOT EXISTS sessions_user_status_idx
  ON iam.sessions (user_id, status, expires_at DESC);

ALTER TABLE iam.auth_email_challenges
  ADD COLUMN IF NOT EXISTS browser_binding_hash bytea,
  ADD COLUMN IF NOT EXISTS anonymous_subject_id uuid,
  ADD COLUMN IF NOT EXISTS email_ciphertext bytea,
  ADD COLUMN IF NOT EXISTS email_key_version varchar(64),
  ADD COLUMN IF NOT EXISTS client_request_id uuid,
  ADD COLUMN IF NOT EXISTS request_payload_hash char(64),
  ADD COLUMN IF NOT EXISTS return_to varchar(2048),
  ADD COLUMN IF NOT EXISTS ip_hash bytea,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

UPDATE iam.auth_email_challenges
SET browser_binding_hash = digest(gen_random_uuid()::text, 'sha256'),
    anonymous_subject_id = gen_random_uuid(),
    email_ciphertext = decode('', 'hex'),
    email_key_version = 'legacy-foundation',
    client_request_id = gen_random_uuid(),
    request_payload_hash = encode(digest(gen_random_uuid()::text, 'sha256'), 'hex'),
    return_to = '/me'
WHERE browser_binding_hash IS NULL;

ALTER TABLE iam.auth_email_challenges
  ALTER COLUMN browser_binding_hash SET NOT NULL,
  ALTER COLUMN anonymous_subject_id SET NOT NULL,
  ALTER COLUMN email_ciphertext SET NOT NULL,
  ALTER COLUMN email_key_version SET NOT NULL,
  ALTER COLUMN client_request_id SET NOT NULL,
  ALTER COLUMN request_payload_hash SET NOT NULL,
  ALTER COLUMN return_to SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS auth_email_challenges_client_request_uniq
  ON iam.auth_email_challenges (anonymous_subject_id, purpose, client_request_id);

CREATE UNIQUE INDEX IF NOT EXISTS auth_email_challenges_flow_uniq
  ON iam.auth_email_challenges (auth_flow_id);

CREATE TABLE IF NOT EXISTS iam.identity_links (
  identity_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_subject_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES iam.users(user_id),
  auth_flow_id uuid NOT NULL,
  purpose varchar(32) NOT NULL
    CHECK (purpose IN ('pending_action_replay', 'query_continuation', 'comparison_merge')),
  status varchar(32) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'consumed', 'revoked', 'expired')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > issued_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS identity_links_flow_purpose_uniq
  ON iam.identity_links (auth_flow_id, purpose);

CREATE TABLE IF NOT EXISTS iam.admin_reauth_grants (
  reauth_grant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES iam.users(user_id),
  primary_session_id_hash bytea NOT NULL REFERENCES iam.sessions(session_id_hash),
  preview_token_hash bytea NOT NULL,
  roles_version bigint NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'consumed', 'revoked', 'expired')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS admin_reauth_grants_session_status_idx
  ON iam.admin_reauth_grants (primary_session_id_hash, status, expires_at DESC);

CREATE TABLE IF NOT EXISTS audit.security_events (
  security_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type varchar(64) NOT NULL,
  severity varchar(16) NOT NULL CHECK (severity IN ('info', 'warning', 'high', 'critical')),
  actor_user_id_hash bytea,
  session_id_hash bytea,
  target_type varchar(64),
  target_id_hash bytea,
  error_code varchar(64),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(metadata_json) = 'object')
);

CREATE INDEX IF NOT EXISTS security_events_type_time_idx
  ON audit.security_events (event_type, created_at DESC);

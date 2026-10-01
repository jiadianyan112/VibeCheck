CREATE TABLE IF NOT EXISTS iam.users (
  user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status varchar(32) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'restricted', 'disabled')),
  role_version bigint NOT NULL DEFAULT 1 CHECK (role_version >= 1),
  privacy_state varchar(32) NOT NULL DEFAULT 'active'
    CHECK (privacy_state IN ('active', 'deletion_requested', 'anonymized')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS iam.user_email_identities (
  email_identity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES iam.users(user_id),
  normalized_email_hash bytea NOT NULL,
  email_ciphertext bytea NOT NULL,
  key_version varchar(64) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'replaced', 'revoked')),
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_email_identities_active_email_uniq
  ON iam.user_email_identities (normalized_email_hash)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS iam.auth_email_challenges (
  challenge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_flow_id uuid NOT NULL,
  purpose varchar(32) NOT NULL CHECK (purpose IN ('login', 'admin_confirm')),
  normalized_email_hash bytea NOT NULL,
  otp_hash bytea NOT NULL,
  otp_salt bytea NOT NULL,
  primary_session_id_hash bytea,
  preview_token_hash bytea,
  return_to_ref uuid,
  status varchar(32) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'consumed', 'expired', 'attempts_exceeded', 'cancelled')),
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  max_attempts smallint NOT NULL DEFAULT 5 CHECK (max_attempts = 5),
  send_receipt_ref varchar(255),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK ((purpose = 'login') OR (primary_session_id_hash IS NOT NULL AND preview_token_hash IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS auth_email_challenges_lookup_idx
  ON iam.auth_email_challenges (normalized_email_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS iam.auth_rate_limit_buckets (
  bucket_key_hash bytea NOT NULL,
  scope varchar(32) NOT NULL
    CHECK (scope IN ('email_send', 'email_verify', 'ip_send', 'ip_verify')),
  window_started_at timestamptz NOT NULL,
  hit_count integer NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_key_hash, scope, window_started_at)
);

CREATE INDEX IF NOT EXISTS auth_rate_limit_blocked_idx
  ON iam.auth_rate_limit_buckets (blocked_until)
  WHERE blocked_until IS NOT NULL;

CREATE TABLE IF NOT EXISTS iam.sessions (
  session_id_hash bytea PRIMARY KEY,
  user_id uuid REFERENCES iam.users(user_id),
  anonymous_subject_id uuid NOT NULL,
  roles_version bigint NOT NULL DEFAULT 1,
  status varchar(32) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'expired')),
  recent_auth_at timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops.outbox_events (
  outbox_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE,
  aggregate_type varchar(64) NOT NULL,
  aggregate_id varchar(128) NOT NULL,
  event_name varchar(128) NOT NULL,
  event_version integer NOT NULL CHECK (event_version >= 1),
  payload_json jsonb NOT NULL,
  transaction_id uuid NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retry_wait', 'published', 'dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_by varchar(128),
  locked_at timestamptz,
  lease_expires_at timestamptz,
  last_error_code varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CHECK (jsonb_typeof(payload_json) = 'object')
);

CREATE INDEX IF NOT EXISTS outbox_claim_idx
  ON ops.outbox_events (event_name, status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'retry_wait');

CREATE TABLE IF NOT EXISTS ops.inbox_receipts (
  consumer_name varchar(128) NOT NULL,
  event_id uuid NOT NULL,
  payload_hash char(64) NOT NULL,
  result varchar(32) NOT NULL CHECK (result IN ('processed', 'ignored', 'rejected')),
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_name, event_id)
);

CREATE TABLE IF NOT EXISTS audit.audit_logs (
  audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id varchar(64) NOT NULL,
  actor_type varchar(32) NOT NULL,
  actor_id_hash bytea,
  actor_roles_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  target_type varchar(64) NOT NULL,
  target_id varchar(128) NOT NULL,
  before_hash char(64),
  after_hash char(64),
  diff_json jsonb,
  reason_code varchar(64) NOT NULL,
  request_id varchar(64) NOT NULL,
  trace_id varchar(64),
  result varchar(32) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_target_time_idx
  ON audit.audit_logs (target_type, target_id, created_at DESC);

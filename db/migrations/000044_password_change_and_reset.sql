ALTER TABLE iam.auth_email_challenges
  DROP CONSTRAINT IF EXISTS auth_email_challenges_purpose_check;
ALTER TABLE iam.auth_email_challenges
  ADD CONSTRAINT auth_email_challenges_purpose_check
  CHECK (purpose IN ('login', 'admin_confirm', 'password_reset'));

DO $$
DECLARE old_binding record;
BEGIN
  FOR old_binding IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'iam.auth_email_challenges'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%primary_session_id_hash IS NOT NULL%'
      AND pg_get_constraintdef(oid) LIKE '%preview_token_hash IS NOT NULL%'
  LOOP
    EXECUTE format('ALTER TABLE iam.auth_email_challenges DROP CONSTRAINT %I', old_binding.conname);
  END LOOP;
END $$;
ALTER TABLE iam.auth_email_challenges
  ADD CONSTRAINT auth_email_challenges_binding_check
  CHECK (purpose <> 'admin_confirm' OR
    (primary_session_id_hash IS NOT NULL AND preview_token_hash IS NOT NULL));

ALTER TABLE iam.auth_rate_limit_buckets
  DROP CONSTRAINT IF EXISTS auth_rate_limit_buckets_scope_check;
ALTER TABLE iam.auth_rate_limit_buckets
  ADD CONSTRAINT auth_rate_limit_buckets_scope_check
  CHECK (scope IN ('email_send', 'email_verify', 'ip_send', 'ip_verify',
    'password_email', 'password_ip', 'password_change_user', 'password_change_ip'));

CREATE TABLE IF NOT EXISTS iam.password_reset_grants (
  grant_hash bytea PRIMARY KEY,
  challenge_id uuid NOT NULL UNIQUE REFERENCES iam.auth_email_challenges(challenge_id),
  user_id uuid NOT NULL REFERENCES iam.users(user_id),
  primary_session_id_hash bytea,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS password_reset_grants_user_idx
  ON iam.password_reset_grants (user_id, expires_at DESC);

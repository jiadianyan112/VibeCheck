CREATE TABLE IF NOT EXISTS iam.user_password_credentials (
  user_id uuid PRIMARY KEY REFERENCES iam.users(user_id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE iam.auth_rate_limit_buckets DROP CONSTRAINT IF EXISTS auth_rate_limit_buckets_scope_check;
ALTER TABLE iam.auth_rate_limit_buckets ADD CONSTRAINT auth_rate_limit_buckets_scope_check
  CHECK (scope IN ('email_send', 'email_verify', 'ip_send', 'ip_verify', 'password_email', 'password_ip'));

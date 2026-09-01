CREATE TABLE IF NOT EXISTS workflow.asset_resolution_receipts (
  attempt_id uuid PRIMARY KEY,
  asset_id uuid NOT NULL REFERENCES catalog.assets(asset_id),
  project_id uuid NOT NULL REFERENCES catalog.projects(project_id),
  subject_kind varchar(16) NOT NULL CHECK (subject_kind IN ('anonymous', 'user')),
  subject_hash bytea NOT NULL CHECK (octet_length(subject_hash) = 32),
  target_kind varchar(24) NOT NULL CHECK (target_kind IN ('safe_web_url', 'contact_uri')),
  target_hash bytea NOT NULL CHECK (octet_length(target_hash) = 32),
  request_hash char(64) NOT NULL,
  result varchar(16) NOT NULL CHECK (result IN ('allowed', 'uncertain', 'blocked')),
  reason_code varchar(64),
  response_json jsonb NOT NULL,
  request_id varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (jsonb_typeof(response_json) = 'object'),
  CHECK (expires_at > created_at),
  CHECK (
    (result = 'allowed' AND reason_code IS NULL) OR
    (result IN ('uncertain', 'blocked') AND reason_code IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS asset_resolution_receipts_expiry_idx
  ON workflow.asset_resolution_receipts (expires_at);

CREATE TABLE IF NOT EXISTS workflow.asset_resolution_rate_limit_buckets (
  subject_hash bytea NOT NULL CHECK (octet_length(subject_hash) = 32),
  window_started_at timestamptz NOT NULL,
  hit_count integer NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_hash, window_started_at)
);

CREATE INDEX IF NOT EXISTS asset_resolution_rate_limit_blocked_idx
  ON workflow.asset_resolution_rate_limit_buckets (blocked_until)
  WHERE blocked_until IS NOT NULL;

CREATE OR REPLACE FUNCTION workflow.reject_asset_resolution_receipt_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_ASSET_RESOLUTION_RECEIPT' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS asset_resolution_receipts_immutable
  ON workflow.asset_resolution_receipts;
CREATE TRIGGER asset_resolution_receipts_immutable
  BEFORE UPDATE OR DELETE ON workflow.asset_resolution_receipts
  FOR EACH ROW EXECUTE FUNCTION workflow.reject_asset_resolution_receipt_mutation();

CREATE TABLE IF NOT EXISTS workflow.submission_operation_receipts (
  owner_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  operation_id varchar(128) NOT NULL,
  operation_type varchar(32) NOT NULL CHECK (operation_type IN ('withdraw')),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  submission_id uuid NOT NULL REFERENCES workflow.submissions(submission_id),
  response_json jsonb NOT NULL CHECK (jsonb_typeof(response_json)='object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_user_id,operation_id)
);

CREATE INDEX IF NOT EXISTS submission_operation_receipts_submission_idx
  ON workflow.submission_operation_receipts (submission_id,created_at,operation_id);

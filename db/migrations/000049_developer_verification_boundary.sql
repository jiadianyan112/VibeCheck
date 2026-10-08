-- Frozen historical requests retain their original permission policy.
-- Every request created by the v1 API opts into the single developer policy.
ALTER TABLE workflow.verification_requests
  ADD COLUMN IF NOT EXISTS developer_identity_v1 boolean NOT NULL DEFAULT false;

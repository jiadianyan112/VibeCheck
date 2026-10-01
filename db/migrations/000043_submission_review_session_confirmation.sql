ALTER TABLE workflow.admin_operation_confirm_grants
  DROP CONSTRAINT IF EXISTS admin_operation_confirm_grants_assurance_source_check;

ALTER TABLE workflow.admin_operation_confirm_grants
  ADD CONSTRAINT admin_operation_confirm_grants_assurance_source_check
  CHECK (assurance_source IN ('recent_session', 'authenticated_session', 'step_up_grant'));

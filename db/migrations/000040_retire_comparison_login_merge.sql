-- The approved P0 login rule preserves the account comparison and never adopts,
-- merges, replaces, or asks the user to reconcile an anonymous comparison.

UPDATE iam.pending_actions action
SET status='cancelled',
    payload_ciphertext=NULL,
    cancelled_at=now(),
    cancel_reason='account_comparison_preserved',
    updated_at=now()
FROM comparison.comparison_merge_conflicts conflict
WHERE conflict.pending_action_id=action.pending_action_id
  AND conflict.status='pending'
  AND action.status='pending'
  AND action.action_type='save_comparison';

UPDATE comparison.comparison_merge_conflicts
SET status='cancelled',
    version=version+1,
    cancelled_at=now(),
    cancel_reason='account_comparison_preserved',
    updated_at=now()
WHERE status='pending';

UPDATE iam.identity_links
SET status='revoked'
WHERE purpose='comparison_merge'
  AND status='active';

INSERT INTO audit.security_events(
  event_type,severity,target_type,metadata_json,request_id,created_at
)
VALUES(
  'comparison_login_merge_retired',
  'info',
  'comparison_policy',
  jsonb_build_object(
    'policy','account_state_only',
    'public_endpoints_removed',true,
    'migration','000040'
  ),
  'migration-000040',
  now()
);

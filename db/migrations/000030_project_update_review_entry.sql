ALTER TABLE catalog.project_update_operations
  DROP CONSTRAINT project_update_operations_operation_type_check;
ALTER TABLE catalog.project_update_operations
  ADD CONSTRAINT project_update_operations_operation_type_check
  CHECK (operation_type IN ('patch','preview','submit','withdraw'));

CREATE UNIQUE INDEX project_updates_active_review_item_uniq
  ON catalog.project_updates (review_work_item_id)
  WHERE review_work_item_id IS NOT NULL;

CREATE OR REPLACE FUNCTION catalog.validate_project_update_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.owner_user_id<>OLD.owner_user_id OR NEW.project_id<>OLD.project_id
     OR NEW.origin_review_status<>OLD.origin_review_status OR NEW.base_version_id<>OLD.base_version_id
     OR NEW.update_type<>OLD.update_type OR NEW.client_request_id<>OLD.client_request_id
     OR NEW.request_hash<>OLD.request_hash OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'PROJECT_UPDATE_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at THEN
    RAISE EXCEPTION 'PROJECT_UPDATE_VERSION_INVALID' USING ERRCODE='23514';
  END IF;
  IF OLD.status IN ('rejected','withdrawn','applied') THEN
    RAISE EXCEPTION 'PROJECT_UPDATE_TERMINAL_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF NOT (
    (OLD.status='editing' AND NEW.status IN ('editing','update_pending','withdrawn')) OR
    (OLD.status='update_pending' AND NEW.status IN ('update_pending','changes_requested','approved','rejected','withdrawn')) OR
    (OLD.status='changes_requested' AND NEW.status IN ('changes_requested','editing','withdrawn')) OR
    (OLD.status='approved' AND NEW.status IN ('approved','applying')) OR
    (OLD.status='applying' AND NEW.status IN ('applying','applied','apply_failed')) OR
    (OLD.status='apply_failed' AND NEW.status IN ('apply_failed','applying','changes_requested','withdrawn'))
  ) THEN
    RAISE EXCEPTION 'PROJECT_UPDATE_TRANSITION_INVALID' USING ERRCODE='23514';
  END IF;
  IF (
    NEW.payload_diff_json IS DISTINCT FROM OLD.payload_diff_json OR
    NEW.before_after_json IS DISTINCT FROM OLD.before_after_json OR
    NEW.evidence_draft_ids_json IS DISTINCT FROM OLD.evidence_draft_ids_json OR
    NEW.media_reference_ids_json IS DISTINCT FROM OLD.media_reference_ids_json OR
    NEW.category_change_type IS DISTINCT FROM OLD.category_change_type
  ) AND NOT (OLD.status='editing' AND NEW.status='editing') THEN
    RAISE EXCEPTION 'PROJECT_UPDATE_PAYLOAD_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF NEW.authorization_snapshot_json IS DISTINCT FROM OLD.authorization_snapshot_json
     AND NOT (OLD.status='editing' AND NEW.status IN ('editing','update_pending')) THEN
    RAISE EXCEPTION 'PROJECT_UPDATE_AUTHORIZATION_SNAPSHOT_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

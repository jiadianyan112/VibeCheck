CREATE TABLE IF NOT EXISTS catalog.project_updates (
  update_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  project_id uuid NOT NULL REFERENCES catalog.projects(project_id),
  origin_review_status varchar(32) NOT NULL,
  base_version_id uuid NOT NULL REFERENCES catalog.project_versions(version_id),
  update_type varchar(32) NOT NULL
    CHECK (update_type IN ('version','address','status','asset','description')),
  category_change_type varchar(64),
  payload_diff_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  before_after_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_draft_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  media_reference_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  authorization_snapshot_json jsonb NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'editing' CHECK (status IN (
    'editing','update_pending','changes_requested','approved','applying',
    'apply_failed','rejected','withdrawn','applied'
  )),
  review_work_item_id uuid REFERENCES workflow.review_work_items(work_item_id),
  apply_attempt_count integer NOT NULL DEFAULT 0 CHECK (apply_attempt_count >= 0),
  client_request_id varchar(128) NOT NULL,
  request_hash char(64) NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  applying_at timestamptz,
  applied_at timestamptz,
  CHECK (jsonb_typeof(payload_diff_json)='array'),
  CHECK (jsonb_typeof(before_after_json)='array'),
  CHECK (jsonb_typeof(evidence_draft_ids_json)='array'),
  CHECK (jsonb_typeof(media_reference_ids_json)='array'),
  CHECK (jsonb_typeof(authorization_snapshot_json)='object'),
  CHECK (origin_review_status='published_author'),
  CHECK (jsonb_array_length(payload_diff_json)<=43),
  CHECK (jsonb_array_length(before_after_json)=jsonb_array_length(payload_diff_json)),
  CHECK (jsonb_array_length(evidence_draft_ids_json)<=50),
  CHECK (jsonb_array_length(media_reference_ids_json)<=20),
  CHECK (updated_at>=created_at)
);

CREATE UNIQUE INDEX project_updates_create_request_uniq
  ON catalog.project_updates (owner_user_id,client_request_id);

CREATE INDEX project_updates_owner_updated_idx
  ON catalog.project_updates (owner_user_id,updated_at DESC,update_id);

CREATE INDEX project_updates_project_status_idx
  ON catalog.project_updates (project_id,status,updated_at DESC);

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
    NEW.authorization_snapshot_json IS DISTINCT FROM OLD.authorization_snapshot_json OR
    NEW.category_change_type IS DISTINCT FROM OLD.category_change_type
  ) AND NOT (OLD.status='editing' AND NEW.status='editing') THEN
    RAISE EXCEPTION 'PROJECT_UPDATE_PAYLOAD_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_updates_validate_mutation
  BEFORE UPDATE ON catalog.project_updates
  FOR EACH ROW EXECUTE FUNCTION catalog.validate_project_update_mutation();

CREATE TRIGGER project_updates_no_delete
  BEFORE DELETE ON catalog.project_updates
  FOR EACH ROW EXECUTE FUNCTION catalog.reject_immutable_mutation();

CREATE TABLE IF NOT EXISTS catalog.project_update_operations (
  update_id uuid NOT NULL REFERENCES catalog.project_updates(update_id),
  owner_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  operation_id varchar(128) NOT NULL,
  operation_type varchar(32) NOT NULL CHECK (operation_type IN ('patch','preview')),
  request_hash char(64) NOT NULL,
  resulting_version bigint NOT NULL CHECK (resulting_version>=1),
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (update_id,owner_user_id,operation_id),
  CHECK (jsonb_typeof(response_json)='object')
);

CREATE TRIGGER project_update_operations_immutable
  BEFORE UPDATE OR DELETE ON catalog.project_update_operations
  FOR EACH ROW EXECUTE FUNCTION catalog.reject_immutable_mutation();

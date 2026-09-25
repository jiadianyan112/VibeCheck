CREATE TABLE IF NOT EXISTS community.project_interactions (
  interaction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES iam.users(user_id),
  project_id uuid NOT NULL REFERENCES catalog.projects(project_id),
  target_type varchar(16) NOT NULL DEFAULT 'project' CHECK (target_type = 'project'),
  interaction_type varchar(16) NOT NULL CHECK (interaction_type IN ('favorite', 'like', 'follow')),
  state boolean NOT NULL,
  client_request_id varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, project_id, interaction_type),
  CHECK (length(client_request_id) BETWEEN 8 AND 128),
  CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS project_interactions_project_state_idx
  ON community.project_interactions (project_id, interaction_type, state)
  WHERE state = true;

CREATE TABLE IF NOT EXISTS community.interaction_operation_receipts (
  user_id uuid NOT NULL REFERENCES iam.users(user_id),
  client_request_id varchar(128) NOT NULL,
  request_hash char(64) NOT NULL,
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_request_id),
  CHECK (length(client_request_id) BETWEEN 8 AND 128),
  CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  CHECK (jsonb_typeof(response_json) = 'object')
);

CREATE OR REPLACE FUNCTION community.enforce_project_follow_favorite()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  checked_user_id uuid;
  checked_project_id uuid;
BEGIN
  checked_user_id := COALESCE(NEW.user_id, OLD.user_id);
  checked_project_id := COALESCE(NEW.project_id, OLD.project_id);
  IF EXISTS (
    SELECT 1
    FROM community.project_interactions follow_state
    WHERE follow_state.user_id = checked_user_id
      AND follow_state.project_id = checked_project_id
      AND follow_state.interaction_type = 'follow'
      AND follow_state.state = true
      AND NOT EXISTS (
        SELECT 1
        FROM community.project_interactions favorite_state
        WHERE favorite_state.user_id = checked_user_id
          AND favorite_state.project_id = checked_project_id
          AND favorite_state.interaction_type = 'favorite'
          AND favorite_state.state = true
      )
  ) THEN
    RAISE EXCEPTION 'FOLLOW_REQUIRES_FAVORITE' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS project_follow_favorite_invariant
  ON community.project_interactions;
CREATE CONSTRAINT TRIGGER project_follow_favorite_invariant
  AFTER INSERT OR UPDATE OR DELETE ON community.project_interactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION community.enforce_project_follow_favorite();

-- Completion requires four distinct visible dimension groups. learning.v1 originally
-- shipped with only three groups, so establish a completable mapping before comparisons
-- can reference the schema version.
UPDATE taxonomy.category_schema_versions
SET comparison_dimension_map = '{
  "audience":["target_users","use_scenarios"],
  "problem":["core_problem","differentiation"],
  "workflow":["core_flow","main_inputs","main_outputs"],
  "capabilities":["practice_formats","feedback_methods","learning_records"]
}'::jsonb
WHERE category_id = 'ai_learning_quiz' AND schema_version = 'learning.v1';

CREATE TABLE IF NOT EXISTS comparison.comparisons (
  comparison_id uuid PRIMARY KEY,
  owner_user_id uuid REFERENCES iam.users(user_id),
  anonymous_subject_hash bytea,
  category_id varchar(64) NOT NULL,
  category_schema_version varchar(32) NOT NULL,
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  status varchar(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'deleted')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (category_id, category_schema_version)
    REFERENCES taxonomy.category_schema_versions(category_id, schema_version),
  CHECK ((owner_user_id IS NOT NULL) <> (anonymous_subject_hash IS NOT NULL)),
  CHECK (anonymous_subject_hash IS NULL OR octet_length(anonymous_subject_hash) = 32),
  CHECK (
    (anonymous_subject_hash IS NOT NULL AND expires_at IS NOT NULL AND expires_at > created_at)
    OR (owner_user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS comparisons_user_owner_idx
  ON comparison.comparisons (owner_user_id, updated_at DESC)
  WHERE owner_user_id IS NOT NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS comparisons_anonymous_owner_idx
  ON comparison.comparisons (anonymous_subject_hash, updated_at DESC)
  WHERE anonymous_subject_hash IS NOT NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS comparisons_expiry_idx
  ON comparison.comparisons (expires_at)
  WHERE expires_at IS NOT NULL AND status = 'active';

CREATE TABLE IF NOT EXISTS comparison.comparison_versions (
  comparison_id uuid NOT NULL REFERENCES comparison.comparisons(comparison_id),
  comparison_version integer NOT NULL CHECK (comparison_version >= 1),
  item_count smallint NOT NULL CHECK (item_count BETWEEN 0 AND 5),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comparison_id, comparison_version)
);

CREATE TABLE IF NOT EXISTS comparison.comparison_items (
  comparison_id uuid NOT NULL,
  comparison_version integer NOT NULL,
  project_id uuid NOT NULL REFERENCES catalog.projects(project_id),
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 5),
  validity_status varchar(16) NOT NULL DEFAULT 'valid'
    CHECK (validity_status IN ('valid', 'invalid')),
  invalid_reason varchar(64),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comparison_id, comparison_version, project_id),
  UNIQUE (comparison_id, comparison_version, position),
  FOREIGN KEY (comparison_id, comparison_version)
    REFERENCES comparison.comparison_versions(comparison_id, comparison_version),
  CHECK (
    (validity_status = 'valid' AND invalid_reason IS NULL)
    OR (validity_status = 'invalid' AND invalid_reason IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS comparison_items_project_idx
  ON comparison.comparison_items (project_id, comparison_id, comparison_version);

CREATE TABLE IF NOT EXISTS comparison.comparison_dimension_progress (
  comparison_id uuid NOT NULL,
  comparison_version integer NOT NULL,
  dimension_group varchar(64) NOT NULL,
  visible_ms bigint NOT NULL DEFAULT 0 CHECK (visible_ms >= 0),
  last_view_sequence integer NOT NULL DEFAULT 0 CHECK (last_view_sequence >= 0),
  last_event_at timestamptz NOT NULL,
  PRIMARY KEY (comparison_id, comparison_version, dimension_group),
  FOREIGN KEY (comparison_id, comparison_version)
    REFERENCES comparison.comparison_versions(comparison_id, comparison_version)
);

CREATE TABLE IF NOT EXISTS comparison.comparison_dimension_events (
  event_id uuid PRIMARY KEY,
  comparison_id uuid NOT NULL,
  comparison_version integer NOT NULL,
  dimension_group varchar(64) NOT NULL,
  view_sequence integer NOT NULL CHECK (view_sequence >= 1),
  visible_ms integer NOT NULL CHECK (visible_ms >= 1000),
  subject_hash bytea NOT NULL CHECK (octet_length(subject_hash) = 32),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comparison_id, comparison_version, dimension_group, view_sequence),
  FOREIGN KEY (comparison_id, comparison_version, dimension_group)
    REFERENCES comparison.comparison_dimension_progress(
      comparison_id, comparison_version, dimension_group
    )
);

CREATE TABLE IF NOT EXISTS comparison.comparison_saves (
  comparison_id uuid NOT NULL,
  comparison_version integer NOT NULL,
  user_id uuid NOT NULL REFERENCES iam.users(user_id),
  state boolean NOT NULL,
  saved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comparison_id, comparison_version, user_id),
  FOREIGN KEY (comparison_id, comparison_version)
    REFERENCES comparison.comparison_versions(comparison_id, comparison_version),
  CHECK ((state AND saved_at IS NOT NULL) OR (NOT state AND saved_at IS NULL))
);

CREATE TABLE IF NOT EXISTS comparison.comparison_mutation_receipts (
  client_request_id uuid NOT NULL,
  subject_hash bytea NOT NULL CHECK (octet_length(subject_hash) = 32),
  comparison_id uuid NOT NULL REFERENCES comparison.comparisons(comparison_id),
  request_hash char(64) NOT NULL,
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_request_id, subject_hash),
  CHECK (jsonb_typeof(response_json) = 'object')
);

CREATE OR REPLACE FUNCTION comparison.reject_immutable_comparison_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_COMPARISON_FACT' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS comparison_items_immutable ON comparison.comparison_items;
CREATE TRIGGER comparison_items_immutable
  BEFORE UPDATE OR DELETE ON comparison.comparison_items
  FOR EACH ROW EXECUTE FUNCTION comparison.reject_immutable_comparison_mutation();

DROP TRIGGER IF EXISTS comparison_dimension_events_immutable
  ON comparison.comparison_dimension_events;
CREATE TRIGGER comparison_dimension_events_immutable
  BEFORE UPDATE OR DELETE ON comparison.comparison_dimension_events
  FOR EACH ROW EXECUTE FUNCTION comparison.reject_immutable_comparison_mutation();

DROP TRIGGER IF EXISTS comparison_mutation_receipts_immutable
  ON comparison.comparison_mutation_receipts;
CREATE TRIGGER comparison_mutation_receipts_immutable
  BEFORE UPDATE OR DELETE ON comparison.comparison_mutation_receipts
  FOR EACH ROW EXECUTE FUNCTION comparison.reject_immutable_comparison_mutation();

CREATE OR REPLACE FUNCTION comparison.guard_comparison_version_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.comparison_id IS DISTINCT FROM NEW.comparison_id
     OR OLD.comparison_version IS DISTINCT FROM NEW.comparison_version
     OR OLD.item_count IS DISTINCT FROM NEW.item_count
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR OLD.completed_at IS NOT NULL
     OR NEW.completed_at IS NULL THEN
    RAISE EXCEPTION 'IMMUTABLE_COMPARISON_VERSION' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comparison_versions_guard
  ON comparison.comparison_versions;
CREATE TRIGGER comparison_versions_guard
  BEFORE UPDATE OR DELETE ON comparison.comparison_versions
  FOR EACH ROW EXECUTE FUNCTION comparison.guard_comparison_version_update();

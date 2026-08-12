CREATE TABLE IF NOT EXISTS search.query_snapshots (
  query_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_subject_kind varchar(16) NOT NULL CHECK (owner_subject_kind IN ('anonymous', 'user')),
  owner_subject_hash bytea NOT NULL CHECK (octet_length(owner_subject_hash) = 32),
  encrypted_data_key bytea NOT NULL,
  data_key_iv bytea NOT NULL CHECK (octet_length(data_key_iv) = 12),
  data_key_auth_tag bytea NOT NULL CHECK (octet_length(data_key_auth_tag) = 16),
  raw_query_ciphertext bytea NOT NULL,
  raw_query_iv bytea NOT NULL CHECK (octet_length(raw_query_iv) = 12),
  raw_query_auth_tag bytea NOT NULL CHECK (octet_length(raw_query_auth_tag) = 16),
  encryption_key_version varchar(64) NOT NULL,
  query_hash bytea NOT NULL CHECK (octet_length(query_hash) = 32),
  query_length_bucket varchar(16) NOT NULL
    CHECK (query_length_bucket IN ('1_10', '11_30', '31_80', '81_200', '201_500')),
  mode varchar(16) NOT NULL CHECK (mode IN ('search', 'discover')),
  category_id varchar(64)
    CHECK (category_id IN ('ai_learning_quiz', 'personal_site_portfolio')),
  locale varchar(35) NOT NULL DEFAULT 'zh-CN',
  active_intent_version integer NOT NULL DEFAULT 1 CHECK (active_intent_version >= 1),
  snapshot_version bigint NOT NULL DEFAULT 1 CHECK (snapshot_version >= 1),
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invalidated')),
  expires_at timestamptz NOT NULL,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (
    (status = 'active' AND invalidated_at IS NULL)
    OR (status = 'invalidated' AND invalidated_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS query_snapshots_owner_idx
  ON search.query_snapshots (owner_subject_hash, status, expires_at DESC);

CREATE INDEX IF NOT EXISTS query_snapshots_expiry_idx
  ON search.query_snapshots (expires_at)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS search.query_authorized_subjects (
  query_id uuid NOT NULL REFERENCES search.query_snapshots(query_id) ON DELETE CASCADE,
  subject_kind varchar(16) NOT NULL CHECK (subject_kind IN ('anonymous', 'user')),
  subject_hash bytea NOT NULL CHECK (octet_length(subject_hash) = 32),
  identity_link_id uuid NOT NULL,
  authorized_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (query_id, subject_hash),
  UNIQUE (identity_link_id),
  CHECK (revoked_at IS NULL OR revoked_at >= authorized_at)
);

CREATE INDEX IF NOT EXISTS query_authorized_subjects_active_idx
  ON search.query_authorized_subjects (subject_hash, query_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS search.intent_versions (
  query_id uuid NOT NULL REFERENCES search.query_snapshots(query_id) ON DELETE CASCADE,
  intent_version integer NOT NULL CHECK (intent_version >= 1),
  intent_json jsonb NOT NULL CHECK (jsonb_typeof(intent_json) = 'object'),
  confidence_json jsonb NOT NULL CHECK (jsonb_typeof(confidence_json) = 'object'),
  parser_version varchar(64) NOT NULL,
  changed_fields_json jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(changed_fields_json) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (query_id, intent_version)
);

CREATE TABLE IF NOT EXISTS search.result_versions (
  result_version uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id uuid NOT NULL REFERENCES search.query_snapshots(query_id) ON DELETE CASCADE,
  intent_version integer NOT NULL,
  request_fingerprint bytea NOT NULL CHECK (octet_length(request_fingerprint) = 32),
  ranking_version varchar(64) NOT NULL,
  parser_version varchar(64) NOT NULL,
  filter_snapshot_json jsonb NOT NULL CHECK (jsonb_typeof(filter_snapshot_json) = 'object'),
  sort varchar(32) NOT NULL,
  semantic_degraded boolean NOT NULL DEFAULT true,
  result_digest bytea NOT NULL CHECK (octet_length(result_digest) = 32),
  exact_count integer NOT NULL CHECK (exact_count >= 0),
  adjacent_count integer NOT NULL CHECK (adjacent_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (query_id, intent_version)
    REFERENCES search.intent_versions(query_id, intent_version),
  UNIQUE (query_id, intent_version, request_fingerprint),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS result_versions_query_idx
  ON search.result_versions (query_id, intent_version, created_at DESC);

CREATE TABLE IF NOT EXISTS search.result_items (
  result_version uuid NOT NULL REFERENCES search.result_versions(result_version) ON DELETE CASCADE,
  group_id varchar(32) NOT NULL CHECK (group_id IN ('exact', 'adjacent')),
  result_item_id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES catalog.projects(project_id),
  group_position integer NOT NULL CHECK (group_position >= 1),
  global_position integer NOT NULL CHECK (global_position >= 1),
  channel varchar(32) NOT NULL CHECK (channel IN ('search_exact', 'search_adjacent')),
  reason_json jsonb NOT NULL CHECK (jsonb_typeof(reason_json) = 'object'),
  token_binding_hash bytea NOT NULL CHECK (octet_length(token_binding_hash) = 32),
  PRIMARY KEY (result_version, result_item_id),
  UNIQUE (result_version, group_id, group_position),
  UNIQUE (result_version, global_position),
  UNIQUE (result_version, project_id)
);

CREATE INDEX IF NOT EXISTS result_items_page_idx
  ON search.result_items (result_version, global_position);

CREATE TABLE IF NOT EXISTS search.rate_limit_buckets (
  bucket_key_hash bytea NOT NULL CHECK (octet_length(bucket_key_hash) = 32),
  scope varchar(32) NOT NULL CHECK (scope IN ('raw_query')),
  window_started_at timestamptz NOT NULL,
  hit_count integer NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_key_hash, scope, window_started_at)
);

CREATE INDEX IF NOT EXISTS search_rate_limit_blocked_idx
  ON search.rate_limit_buckets (blocked_until)
  WHERE blocked_until IS NOT NULL;

CREATE OR REPLACE FUNCTION search.protect_query_snapshot_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.owner_subject_kind IS DISTINCT FROM OLD.owner_subject_kind
     OR NEW.owner_subject_hash IS DISTINCT FROM OLD.owner_subject_hash
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.encrypted_data_key IS DISTINCT FROM OLD.encrypted_data_key
     OR NEW.data_key_iv IS DISTINCT FROM OLD.data_key_iv
     OR NEW.data_key_auth_tag IS DISTINCT FROM OLD.data_key_auth_tag
     OR NEW.raw_query_ciphertext IS DISTINCT FROM OLD.raw_query_ciphertext
     OR NEW.raw_query_iv IS DISTINCT FROM OLD.raw_query_iv
     OR NEW.raw_query_auth_tag IS DISTINCT FROM OLD.raw_query_auth_tag
     OR NEW.encryption_key_version IS DISTINCT FROM OLD.encryption_key_version
     OR NEW.query_hash IS DISTINCT FROM OLD.query_hash THEN
    RAISE EXCEPTION 'QUERY_SNAPSHOT_IMMUTABLE_FIELD';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS query_snapshots_identity_immutable ON search.query_snapshots;
CREATE TRIGGER query_snapshots_identity_immutable
  BEFORE UPDATE ON search.query_snapshots
  FOR EACH ROW EXECUTE FUNCTION search.protect_query_snapshot_identity();

CREATE OR REPLACE FUNCTION search.reject_immutable_row_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'SEARCH_SNAPSHOT_ROW_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS intent_versions_immutable ON search.intent_versions;
CREATE TRIGGER intent_versions_immutable
  BEFORE UPDATE ON search.intent_versions
  FOR EACH ROW EXECUTE FUNCTION search.reject_immutable_row_change();

DROP TRIGGER IF EXISTS result_versions_immutable ON search.result_versions;
CREATE TRIGGER result_versions_immutable
  BEFORE UPDATE ON search.result_versions
  FOR EACH ROW EXECUTE FUNCTION search.reject_immutable_row_change();

DROP TRIGGER IF EXISTS result_items_immutable ON search.result_items;
CREATE TRIGGER result_items_immutable
  BEFORE UPDATE ON search.result_items
  FOR EACH ROW EXECUTE FUNCTION search.reject_immutable_row_change();

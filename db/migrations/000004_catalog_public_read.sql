CREATE TABLE IF NOT EXISTS taxonomy.category_schema_versions (
  category_id varchar(64) NOT NULL,
  schema_version varchar(32) NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  json_schema jsonb NOT NULL,
  comparison_dimension_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  search_field_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash char(64) GENERATED ALWAYS AS (
    encode(digest(
      category_id || '|' || schema_version || '|' || json_schema::text || '|' ||
      comparison_dimension_map::text || '|' || search_field_map::text,
      'sha256'
    ), 'hex')
  ) STORED,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (category_id, schema_version),
  CHECK (jsonb_typeof(json_schema) = 'object'),
  CHECK (jsonb_typeof(comparison_dimension_map) = 'object'),
  CHECK (jsonb_typeof(search_field_map) = 'object'),
  CHECK (
    (status = 'draft' AND published_at IS NULL)
    OR (status IN ('published', 'retired') AND published_at IS NOT NULL)
  )
);

INSERT INTO taxonomy.category_schema_versions (
  category_id,
  schema_version,
  status,
  json_schema,
  comparison_dimension_map,
  search_field_map,
  published_at
) VALUES
  (
    'ai_learning_quiz',
    'learning.v1',
    'published',
    '{"type":"object","additionalProperties":true,"required":["target_users","core_problem","use_scenarios","main_inputs","main_outputs","core_flow","login_requirement","sharing_capability"],"x-runtime-validator":"@vibecheck/catalog:learning.v1"}'::jsonb,
    '{"audience":["target_users"],"workflow":["core_flow","main_inputs","main_outputs"],"capabilities":["practice_formats","feedback_methods","learning_records"]}'::jsonb,
    '{"keyword":["core_problem","differentiation","core_features"],"filters":["target_users","use_scenarios","main_inputs","main_outputs","practice_formats"]}'::jsonb,
    now()
  ),
  (
    'personal_site_portfolio',
    'portfolio.v1',
    'published',
    '{"type":"object","additionalProperties":true,"required":["site_type","creator_roles","primary_goals","page_model","core_modules","project_showcase_format","case_study_depth","visual_styles","layout_patterns","color_character","theme_mode","interaction_level","interaction_patterns","responsive_support","blog_support"],"x-runtime-validator":"@vibecheck/catalog:portfolio.v1"}'::jsonb,
    '{"purpose":["site_type","creator_roles","primary_goals"],"structure":["page_model","navigation_pattern","core_modules","project_showcase_format"],"visual":["visual_styles","layout_patterns","color_character","theme_mode"],"interaction":["interaction_level","interaction_patterns","responsive_support"]}'::jsonb,
    '{"keyword":["creator_roles","primary_goals","core_modules"],"filters":["site_type","page_model","visual_styles","layout_patterns","theme_mode","responsive_support"]}'::jsonb,
    now()
  )
ON CONFLICT (category_id, schema_version) DO NOTHING;

CREATE TABLE IF NOT EXISTS catalog.projects (
  project_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  current_version_id uuid,
  current_name varchar(80) NOT NULL,
  category_id varchar(64) NOT NULL,
  category_schema_version varchar(32) NOT NULL,
  canonical_public_url varchar(2048) NOT NULL,
  canonical_url_hash bytea NOT NULL,
  review_status varchar(32) NOT NULL
    CHECK (review_status IN ('published_platform', 'published_author', 'restricted', 'archived', 'deleted')),
  origin_publication_status varchar(32)
    CHECK (origin_publication_status IN ('published_platform', 'published_author')),
  access_status varchar(32) NOT NULL DEFAULT 'unknown'
    CHECK (access_status IN ('normal', 'login_required', 'partial_abnormal', 'link_unavailable', 'suspected_migration', 'paused', 'ended', 'unknown')),
  http_check_status varchar(32) NOT NULL DEFAULT 'unknown'
    CHECK (http_check_status IN ('normal', 'redirect', 'timeout', 'dns_error', 'certificate_error', 'blocked', 'unknown')),
  author_link_status varchar(32) NOT NULL DEFAULT 'unlinked'
    CHECK (author_link_status IN ('unlinked', 'pending', 'linked', 'failed', 'disputed')),
  completeness_level varchar(32) NOT NULL DEFAULT 'pending_verification'
    CHECK (completeness_level IN ('complete', 'partial', 'limited', 'pending_verification', 'disputed')),
  freshness_status varchar(16) NOT NULL DEFAULT 'valid'
    CHECK (freshness_status IN ('valid', 'expiring', 'expired')),
  record_source varchar(32) NOT NULL
    CHECK (record_source IN ('platform_editor', 'public_discovery', 'author_submission', 'user_submission')),
  first_seen_at timestamptz NOT NULL,
  last_verified_at timestamptz NOT NULL,
  aggregate_version bigint NOT NULL DEFAULT 1 CHECK (aggregate_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (category_id, category_schema_version)
    REFERENCES taxonomy.category_schema_versions(category_id, schema_version),
  CHECK (first_seen_at <= created_at),
  CHECK (last_verified_at <= updated_at + interval '5 minutes'),
  CHECK (
    (review_status IN ('restricted', 'archived') AND origin_publication_status IS NOT NULL)
    OR (review_status NOT IN ('restricted', 'archived'))
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS projects_canonical_url_uniq
  ON catalog.projects (canonical_url_hash)
  WHERE review_status <> 'deleted';

CREATE INDEX IF NOT EXISTS projects_public_list_idx
  ON catalog.projects (category_id, review_status, updated_at DESC, project_id);

CREATE INDEX IF NOT EXISTS projects_access_idx
  ON catalog.projects (category_id, access_status, review_status);

CREATE INDEX IF NOT EXISTS projects_name_trgm_idx
  ON catalog.projects USING gin (current_name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS catalog.project_versions (
  version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES catalog.projects(project_id),
  version_number integer NOT NULL CHECK (version_number >= 1),
  previous_version_id uuid REFERENCES catalog.project_versions(version_id),
  category_id varchar(64) NOT NULL,
  category_schema_version varchar(32) NOT NULL,
  snapshot_json jsonb NOT NULL,
  source_decision_type varchar(32) NOT NULL
    CHECK (source_decision_type IN ('publication_review', 'project_update_review', 'admin_fact', 'system_fact')),
  source_decision_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  effective_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version_number),
  UNIQUE (source_decision_type, source_decision_id),
  FOREIGN KEY (category_id, category_schema_version)
    REFERENCES taxonomy.category_schema_versions(category_id, schema_version),
  CHECK (jsonb_typeof(snapshot_json) = 'object')
);

ALTER TABLE catalog.projects
  ADD CONSTRAINT projects_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES catalog.project_versions(version_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS project_versions_history_idx
  ON catalog.project_versions (project_id, version_number DESC);

CREATE OR REPLACE FUNCTION catalog.reject_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_CATALOG_FACT' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS project_versions_immutable ON catalog.project_versions;
CREATE TRIGGER project_versions_immutable
  BEFORE UPDATE OR DELETE ON catalog.project_versions
  FOR EACH ROW EXECUTE FUNCTION catalog.reject_immutable_mutation();

CREATE OR REPLACE FUNCTION catalog.validate_current_project_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_record record;
BEGIN
  SELECT version.project_id, version.category_id, version.category_schema_version
    INTO current_record
    FROM catalog.projects project
    LEFT JOIN catalog.project_versions version ON version.version_id = project.current_version_id
    WHERE project.project_id = NEW.project_id;
  IF current_record.project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'PROJECT_CURRENT_VERSION_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF current_record.category_id IS DISTINCT FROM (
       SELECT category_id FROM catalog.projects WHERE project_id = NEW.project_id
     ) OR current_record.category_schema_version IS DISTINCT FROM (
       SELECT category_schema_version FROM catalog.projects WHERE project_id = NEW.project_id
     ) THEN
    RAISE EXCEPTION 'PROJECT_CURRENT_VERSION_SCHEMA_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_current_version_valid ON catalog.projects;
CREATE CONSTRAINT TRIGGER projects_current_version_valid
  AFTER INSERT OR UPDATE OF current_version_id, category_id, category_schema_version
  ON catalog.projects
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION catalog.validate_current_project_version();

CREATE TABLE IF NOT EXISTS catalog.project_name_aliases (
  alias_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES catalog.projects(project_id),
  name varchar(80) NOT NULL,
  normalized_name varchar(80) NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX IF NOT EXISTS project_name_aliases_lookup_idx
  ON catalog.project_name_aliases (normalized_name);

CREATE TABLE IF NOT EXISTS catalog.project_url_aliases (
  alias_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES catalog.projects(project_id),
  canonical_url varchar(2048) NOT NULL,
  url_hash bytea NOT NULL UNIQUE,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  redirect_kind varchar(16) NOT NULL CHECK (redirect_kind IN ('historical', 'merged')),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE TABLE IF NOT EXISTS catalog.creators (
  creator_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  current_profile_version_id uuid,
  aggregate_version bigint NOT NULL DEFAULT 1 CHECK (aggregate_version >= 1),
  owner_link_set_version bigint NOT NULL DEFAULT 1 CHECK (owner_link_set_version >= 1),
  canonical_creator_id uuid REFERENCES catalog.creators(creator_id),
  merge_status varchar(16) NOT NULL DEFAULT 'canonical'
    CHECK (merge_status IN ('canonical', 'merged', 'disputed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((merge_status = 'merged') = (canonical_creator_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS creators_canonical_idx
  ON catalog.creators (canonical_creator_id);

CREATE TABLE IF NOT EXISTS catalog.creator_profile_versions (
  creator_profile_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES catalog.creators(creator_id),
  base_version_id uuid REFERENCES catalog.creator_profile_versions(creator_profile_version_id),
  source_creator_profile_draft_id uuid,
  source_verification_request_id uuid,
  profile_snapshot_json jsonb NOT NULL,
  avatar_media_reference_id uuid,
  published_by_admin_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(profile_snapshot_json) = 'object'),
  CHECK ((source_creator_profile_draft_id IS NULL) <> (source_verification_request_id IS NULL))
);

ALTER TABLE catalog.creators
  ADD CONSTRAINT creators_current_profile_fk
  FOREIGN KEY (current_profile_version_id)
  REFERENCES catalog.creator_profile_versions(creator_profile_version_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS creator_profile_history_idx
  ON catalog.creator_profile_versions (creator_id, created_at DESC);

DROP TRIGGER IF EXISTS creator_profiles_immutable ON catalog.creator_profile_versions;
CREATE TRIGGER creator_profiles_immutable
  BEFORE UPDATE OR DELETE ON catalog.creator_profile_versions
  FOR EACH ROW EXECUTE FUNCTION catalog.reject_immutable_mutation();

CREATE OR REPLACE FUNCTION catalog.validate_current_creator_profile()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_creator_id uuid;
BEGIN
  SELECT profile.creator_id
    INTO current_creator_id
    FROM catalog.creators creator
    LEFT JOIN catalog.creator_profile_versions profile
      ON profile.creator_profile_version_id = creator.current_profile_version_id
    WHERE creator.creator_id = NEW.creator_id;
  IF current_creator_id IS DISTINCT FROM NEW.creator_id THEN
    RAISE EXCEPTION 'CREATOR_CURRENT_PROFILE_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS creators_current_profile_valid ON catalog.creators;
CREATE CONSTRAINT TRIGGER creators_current_profile_valid
  AFTER INSERT OR UPDATE OF current_profile_version_id
  ON catalog.creators
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION catalog.validate_current_creator_profile();

CREATE OR REPLACE FUNCTION catalog.reject_creator_merge_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cycle_found boolean;
BEGIN
  IF NEW.canonical_creator_id IS NULL THEN
    RETURN NEW;
  END IF;
  WITH RECURSIVE canonical_chain AS (
    SELECT creator_id, canonical_creator_id
      FROM catalog.creators
      WHERE creator_id = NEW.canonical_creator_id
    UNION
    SELECT creator.creator_id, creator.canonical_creator_id
      FROM catalog.creators creator
      JOIN canonical_chain parent ON creator.creator_id = parent.canonical_creator_id
  )
  SELECT EXISTS (
    SELECT 1 FROM canonical_chain WHERE creator_id = NEW.creator_id
  ) INTO cycle_found;
  IF cycle_found OR NEW.canonical_creator_id = NEW.creator_id THEN
    RAISE EXCEPTION 'CREATOR_CANONICAL_CYCLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS creators_merge_cycle_guard ON catalog.creators;
CREATE TRIGGER creators_merge_cycle_guard
  BEFORE INSERT OR UPDATE OF canonical_creator_id
  ON catalog.creators
  FOR EACH ROW EXECUTE FUNCTION catalog.reject_creator_merge_cycle();

CREATE TABLE IF NOT EXISTS catalog.author_relations (
  author_relation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES catalog.projects(project_id),
  creator_id uuid NOT NULL REFERENCES catalog.creators(creator_id),
  status varchar(16) NOT NULL CHECK (status IN ('active', 'suspended', 'terminated', 'replaced')),
  author_role varchar(64) NOT NULL,
  field_permissions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_verification_id uuid NOT NULL,
  replacement_relation_id uuid REFERENCES catalog.author_relations(author_relation_id),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(field_permissions_json) = 'array')
);

CREATE INDEX IF NOT EXISTS author_relations_project_idx
  ON catalog.author_relations (project_id, status, creator_id);

CREATE INDEX IF NOT EXISTS author_relations_creator_idx
  ON catalog.author_relations (creator_id, status, project_id);

CREATE TABLE IF NOT EXISTS catalog.evidence (
  evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type varchar(32) NOT NULL CHECK (object_type IN ('project', 'project_version', 'event', 'asset', 'relation', 'creator')),
  object_id uuid NOT NULL,
  project_id uuid REFERENCES catalog.projects(project_id),
  version_id uuid REFERENCES catalog.project_versions(version_id),
  event_id uuid,
  field_path varchar(512) NOT NULL,
  evidence_type varchar(64) NOT NULL
    CHECK (evidence_type IN ('platform_verified_fact', 'verified_author_statement', 'trusted_external_source', 'system_inference')),
  source_channel varchar(64) NOT NULL,
  source_url varchar(2048),
  source_summary varchar(500) NOT NULL,
  captured_at timestamptz NOT NULL,
  collected_by varchar(64) NOT NULL,
  confidence varchar(16) NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  visibility varchar(16) NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private', 'reviewer_only')),
  validity_status varchar(16) NOT NULL DEFAULT 'valid' CHECK (validity_status IN ('valid', 'invalid', 'superseded')),
  freshness_status varchar(16) NOT NULL DEFAULT 'valid' CHECK (freshness_status IN ('valid', 'expiring', 'expired')),
  dispute_status varchar(32) NOT NULL DEFAULT 'none'
    CHECK (dispute_status IN ('none', 'in_review', 'resolved', 'insufficient_evidence')),
  validity_decision_type varchar(32),
  validity_decision_id uuid,
  source_evidence_draft_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((validity_decision_type IS NULL) = (validity_decision_id IS NULL))
);

CREATE INDEX IF NOT EXISTS evidence_target_idx
  ON catalog.evidence (object_type, object_id, field_path, validity_status);

CREATE TABLE IF NOT EXISTS catalog.events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES catalog.projects(project_id),
  version_id uuid REFERENCES catalog.project_versions(version_id),
  event_type varchar(64) NOT NULL,
  event_time timestamptz NOT NULL,
  time_precision varchar(16) NOT NULL CHECK (time_precision IN ('exact', 'day', 'month', 'year', 'estimated')),
  event_summary varchar(500) NOT NULL,
  source_type varchar(64) NOT NULL,
  source_id uuid NOT NULL,
  evidence_id uuid REFERENCES catalog.evidence(evidence_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id)
);

ALTER TABLE catalog.evidence
  ADD CONSTRAINT evidence_event_fk
  FOREIGN KEY (event_id) REFERENCES catalog.events(event_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS events_project_time_idx
  ON catalog.events (project_id, event_time DESC, event_id DESC);

DROP TRIGGER IF EXISTS events_immutable ON catalog.events;
CREATE TRIGGER events_immutable
  BEFORE UPDATE OR DELETE ON catalog.events
  FOR EACH ROW EXECUTE FUNCTION catalog.reject_immutable_mutation();

CREATE TABLE IF NOT EXISTS catalog.assets (
  asset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES catalog.projects(project_id),
  asset_type varchar(64) NOT NULL,
  name varchar(120) NOT NULL,
  description varchar(500) NOT NULL DEFAULT '',
  canonical_url varchar(2048) NOT NULL,
  canonical_url_hash bytea NOT NULL,
  availability_status varchar(32) NOT NULL
    CHECK (availability_status IN ('available', 'login_required', 'link_abnormal', 'removed', 'unknown')),
  visibility varchar(16) NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private', 'reviewer_only')),
  license varchar(120),
  price_json jsonb NOT NULL DEFAULT '{"type":"unknown"}'::jsonb,
  evidence_id uuid REFERENCES catalog.evidence(evidence_id),
  last_verified_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(price_json) = 'object')
);

CREATE INDEX IF NOT EXISTS assets_project_status_idx
  ON catalog.assets (project_id, availability_status, asset_type);

CREATE INDEX IF NOT EXISTS assets_url_idx
  ON catalog.assets (canonical_url_hash);

CREATE TABLE IF NOT EXISTS catalog.relations (
  relation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type varchar(32) NOT NULL CHECK (subject_type IN ('project', 'creator', 'asset')),
  subject_id uuid NOT NULL,
  object_type varchar(32) NOT NULL CHECK (object_type IN ('project', 'creator', 'asset')),
  object_id uuid NOT NULL,
  relation_type varchar(64) NOT NULL,
  direction varchar(16) NOT NULL CHECK (direction IN ('one_way', 'two_way')),
  status varchar(32) NOT NULL CHECK (status IN ('pending', 'one_party_confirmed', 'both_parties_confirmed', 'platform_confirmed', 'disputed')),
  source_decision_id uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_type, subject_id, object_type, object_id, relation_type),
  CHECK (subject_type <> object_type OR subject_id <> object_id)
);

CREATE INDEX IF NOT EXISTS relations_subject_idx
  ON catalog.relations (subject_type, subject_id, status);

CREATE INDEX IF NOT EXISTS relations_object_idx
  ON catalog.relations (object_type, object_id, status);

CREATE TABLE IF NOT EXISTS catalog.project_interaction_counters (
  project_id uuid PRIMARY KEY REFERENCES catalog.projects(project_id),
  favorite_count bigint NOT NULL DEFAULT 0 CHECK (favorite_count >= 0),
  like_count bigint NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  follower_count bigint NOT NULL DEFAULT 0 CHECK (follower_count >= 0),
  visible_comment_count bigint NOT NULL DEFAULT 0 CHECK (visible_comment_count >= 0),
  recalculated_at timestamptz NOT NULL DEFAULT now(),
  source_watermark varchar(128) NOT NULL DEFAULT 'initial'
);

CREATE TABLE IF NOT EXISTS search.project_documents (
  project_id uuid PRIMARY KEY REFERENCES catalog.projects(project_id),
  version_id uuid NOT NULL REFERENCES catalog.project_versions(version_id),
  category_id varchar(64) NOT NULL,
  visibility varchar(16) NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'restricted')),
  structured_json jsonb NOT NULL,
  search_text text NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', search_text)) STORED,
  ranking_features_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(structured_json) = 'object'),
  CHECK (jsonb_typeof(ranking_features_json) = 'object')
);

CREATE INDEX IF NOT EXISTS project_documents_search_idx
  ON search.project_documents USING gin (search_vector);

CREATE INDEX IF NOT EXISTS project_documents_category_idx
  ON search.project_documents (category_id, visibility, indexed_at DESC, project_id);

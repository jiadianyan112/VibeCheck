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
  source_evidence_draft_id uuid UNIQUE,
  object_type varchar(32) NOT NULL
    CHECK (object_type IN ('project', 'version', 'event', 'asset', 'relation', 'creator', 'author_relation')),
  object_id uuid NOT NULL,
  project_id uuid REFERENCES catalog.projects(project_id),
  version_id uuid REFERENCES catalog.project_versions(version_id),
  event_id uuid,
  field_path varchar(240),
  evidence_type varchar(64) NOT NULL
    CHECK (evidence_type IN ('platform_verified_fact', 'verified_author_statement', 'trusted_external_source', 'system_inference')),
  source_channel varchar(64) NOT NULL
    CHECK (source_channel IN ('official_site', 'repository', 'release_note', 'media_report', 'author_statement', 'platform_check')),
  source_url varchar(2048),
  internal_record_ref varchar(240),
  source_summary varchar(2000) NOT NULL,
  captured_at timestamptz NOT NULL,
  verified_at timestamptz,
  collected_by varchar(64) NOT NULL
    CHECK (collected_by IN ('system', 'platform_editor', 'verified_author', 'user')),
  confidence varchar(16) NOT NULL CHECK (confidence IN ('high', 'medium', 'low', 'unknown')),
  visibility varchar(16) NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private', 'reviewer_only')),
  validity_status varchar(24) NOT NULL DEFAULT 'pending_review'
    CHECK (validity_status IN ('pending_review', 'valid', 'suspended', 'invalid', 'revoked')),
  freshness_status varchar(16) NOT NULL DEFAULT 'valid' CHECK (freshness_status IN ('valid', 'expiring', 'expired')),
  dispute_status varchar(32) NOT NULL DEFAULT 'none'
    CHECK (dispute_status IN ('none', 'in_review', 'resolved', 'insufficient_evidence')),
  validity_decision_type varchar(32)
    CHECK (validity_decision_type IN ('review_decision', 'admin_fact_decision')),
  validity_decision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((validity_decision_type IS NULL) = (validity_decision_id IS NULL)),
  CHECK (
    (validity_status = 'pending_review' AND validity_decision_id IS NULL)
    OR (validity_status <> 'pending_review' AND validity_decision_id IS NOT NULL)
  ),
  CHECK (source_url IS NULL OR source_url ~* '^https?://'),
  CHECK (verified_at IS NULL OR verified_at >= captured_at)
);

CREATE INDEX IF NOT EXISTS evidence_target_idx
  ON catalog.evidence (object_type, object_id, field_path, validity_status);

CREATE TABLE IF NOT EXISTS catalog.events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES catalog.projects(project_id),
  version_id uuid REFERENCES catalog.project_versions(version_id),
  event_type varchar(64) NOT NULL
    CHECK (event_type IN ('first_seen', 'first_published', 'version_updated', 'domain_migrated', 'product_pivoted', 'link_abnormal', 'recovered', 'paused', 'ended', 'asset_added', 'reused_by_project', 'relation_added')),
  category_change_type varchar(64)
    CHECK (category_change_type IN ('project_added', 'case_study_added', 'blog_added', 'resume_updated', 'visual_redesign', 'theme_changed', 'tech_stack_changed', 'source_opened', 'site_repositioned')),
  event_time varchar(10) NOT NULL,
  time_precision varchar(16) NOT NULL CHECK (time_precision IN ('day', 'month', 'year', 'estimated')),
  event_sort_at timestamptz NOT NULL,
  event_sort_rule_version varchar(40) NOT NULL DEFAULT 'event_sort.v1'
    CHECK (event_sort_rule_version = 'event_sort.v1'),
  event_summary varchar(1000) NOT NULL,
  before_after jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_actor varchar(32) NOT NULL
    CHECK (source_actor IN ('system', 'platform_editor', 'verified_author', 'public_observation')),
  source_object_type varchar(32) NOT NULL
    CHECK (source_object_type IN ('submission', 'project_update', 'admin_operation', 'system_check')),
  source_object_id uuid NOT NULL,
  supersedes_event_id uuid REFERENCES catalog.events(event_id) DEFERRABLE INITIALLY DEFERRED,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_object_type, source_object_id),
  CHECK (category_change_type IS NULL OR event_type = 'version_updated'),
  CHECK (jsonb_typeof(before_after) = 'array' AND jsonb_array_length(before_after) <= 100),
  CHECK (
    (time_precision IN ('day', 'estimated') AND event_time ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    OR (time_precision = 'month' AND event_time ~ '^[0-9]{4}-[0-9]{2}$')
    OR (time_precision = 'year' AND event_time ~ '^[0-9]{4}$')
  ),
  CHECK (
    event_sort_at = CASE time_precision
      WHEN 'day' THEN make_timestamptz(substring(event_time, 1, 4)::int, substring(event_time, 6, 2)::int, substring(event_time, 9, 2)::int, 0, 0, 0, 'UTC')
      WHEN 'estimated' THEN make_timestamptz(substring(event_time, 1, 4)::int, substring(event_time, 6, 2)::int, substring(event_time, 9, 2)::int, 0, 0, 0, 'UTC')
      WHEN 'month' THEN make_timestamptz(substring(event_time, 1, 4)::int, substring(event_time, 6, 2)::int, 1, 0, 0, 0, 'UTC')
      WHEN 'year' THEN make_timestamptz(substring(event_time, 1, 4)::int, 1, 1, 0, 0, 0, 'UTC')
    END
  ),
  CHECK (supersedes_event_id IS NULL OR supersedes_event_id <> event_id)
);

ALTER TABLE catalog.evidence
  ADD CONSTRAINT evidence_event_fk
  FOREIGN KEY (event_id) REFERENCES catalog.events(event_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS events_project_time_idx
  ON catalog.events (project_id, event_sort_at DESC, event_id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS events_single_replacement_idx
  ON catalog.events (supersedes_event_id)
  WHERE supersedes_event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION catalog.validate_event_links()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM catalog.project_versions version
      WHERE version.version_id = NEW.version_id AND version.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'EVENT_VERSION_PROJECT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF NEW.supersedes_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM catalog.events previous
      WHERE previous.event_id = NEW.supersedes_event_id AND previous.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'EVENT_SUPERSEDES_PROJECT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS event_links_valid ON catalog.events;
CREATE TRIGGER event_links_valid
  BEFORE INSERT ON catalog.events
  FOR EACH ROW EXECUTE FUNCTION catalog.validate_event_links();

DROP TRIGGER IF EXISTS events_immutable ON catalog.events;
CREATE TRIGGER events_immutable
  BEFORE UPDATE OR DELETE ON catalog.events
  FOR EACH ROW EXECUTE FUNCTION catalog.reject_immutable_mutation();

CREATE TABLE IF NOT EXISTS catalog.evidence_attachments (
  attachment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id uuid NOT NULL REFERENCES catalog.evidence(evidence_id),
  media_resource_id uuid NOT NULL,
  role varchar(64) NOT NULL,
  visibility varchar(16) NOT NULL CHECK (visibility IN ('public', 'reviewer_only', 'private')),
  source_attachment_draft_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS evidence_attachments_evidence_idx
  ON catalog.evidence_attachments (evidence_id, attachment_id);

DROP TRIGGER IF EXISTS evidence_attachments_immutable ON catalog.evidence_attachments;
CREATE TRIGGER evidence_attachments_immutable
  BEFORE UPDATE OR DELETE ON catalog.evidence_attachments
  FOR EACH ROW EXECUTE FUNCTION catalog.reject_immutable_mutation();

CREATE TABLE IF NOT EXISTS catalog.assets (
  asset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES catalog.projects(project_id),
  asset_type varchar(64) NOT NULL
    CHECK (asset_type IN ('source_code', 'starter', 'template', 'page_layout', 'ui_component', 'motion_interaction', 'theme_design_system', 'resume_module', 'blog_cms_module', 'deployment_config', 'prompt', 'design_file')),
  component_role varchar(64)
    CHECK (component_role IN ('hero', 'navigation', 'project_showcase', 'case_study', 'contact', 'footer', 'resume', 'blog', 'theme', 'motion', 'other')),
  name varchar(120) NOT NULL,
  description varchar(1000) NOT NULL,
  safe_web_url varchar(2048),
  contact_uri varchar(512),
  target_hash bytea NOT NULL,
  license_type varchar(120) NOT NULL DEFAULT 'unknown',
  price_type varchar(24) NOT NULL DEFAULT 'unknown'
    CHECK (price_type IN ('free', 'paid', 'contact', 'unknown')),
  acquisition_method varchar(32) NOT NULL
    CHECK (acquisition_method IN ('repository', 'clone', 'fork', 'use_template', 'direct_download', 'purchase', 'contact')),
  availability_status varchar(32) NOT NULL
    CHECK (availability_status IN ('available', 'login_required', 'paid', 'contact_required', 'link_abnormal', 'removed', 'unknown')),
  visibility varchar(16) NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private', 'reviewer_only')),
  last_verified_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (safe_web_url IS NOT NULL OR contact_uri IS NOT NULL),
  CHECK (safe_web_url IS NULL OR safe_web_url ~* '^https?://'),
  CHECK (contact_uri IS NULL OR contact_uri ~* '^(mailto:|tel:)'),
  CHECK (last_verified_at <= updated_at + interval '5 minutes')
);

CREATE INDEX IF NOT EXISTS assets_project_status_idx
  ON catalog.assets (project_id, availability_status, asset_type);

CREATE INDEX IF NOT EXISTS assets_url_idx
  ON catalog.assets (target_hash);

CREATE TABLE IF NOT EXISTS catalog.relations (
  relation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_project_id uuid NOT NULL REFERENCES catalog.projects(project_id),
  object_project_id uuid NOT NULL REFERENCES catalog.projects(project_id),
  relation_type varchar(64) NOT NULL
    CHECK (relation_type IN ('inspired_by', 'reference', 'fork', 'remix', 'based_on_template', 'uses_component', 'source_derivative')),
  asset_id uuid REFERENCES catalog.assets(asset_id),
  statement_by varchar(32) NOT NULL
    CHECK (statement_by IN ('subject_author', 'object_author', 'platform', 'system')),
  statement_summary varchar(1000) NOT NULL,
  confirmation_status varchar(32) NOT NULL DEFAULT 'pending'
    CHECK (confirmation_status IN ('pending', 'unilateral_confirmed', 'bilateral_confirmed', 'platform_verified', 'disputed', 'rejected')),
  source_decision_id uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  last_verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_project_id, object_project_id, relation_type),
  CHECK (subject_project_id <> object_project_id),
  CHECK (last_verified_at <= updated_at + interval '5 minutes')
);

CREATE INDEX IF NOT EXISTS relations_subject_idx
  ON catalog.relations (subject_project_id, confirmation_status, relation_type);

CREATE INDEX IF NOT EXISTS relations_object_idx
  ON catalog.relations (object_project_id, confirmation_status, relation_type);

CREATE OR REPLACE FUNCTION catalog.validate_relation_asset_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.asset_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM catalog.assets asset
      WHERE asset.asset_id = NEW.asset_id AND asset.project_id = NEW.object_project_id
  ) THEN
    RAISE EXCEPTION 'RELATION_ASSET_OWNER_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS relation_asset_owner_valid ON catalog.relations;
CREATE TRIGGER relation_asset_owner_valid
  BEFORE INSERT OR UPDATE OF asset_id, object_project_id
  ON catalog.relations
  FOR EACH ROW EXECUTE FUNCTION catalog.validate_relation_asset_owner();

CREATE OR REPLACE FUNCTION catalog.validate_evidence_target()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  CASE NEW.object_type
    WHEN 'project' THEN
      IF NEW.project_id IS DISTINCT FROM NEW.object_id
         OR NEW.version_id IS NOT NULL OR NEW.event_id IS NOT NULL
         OR NOT EXISTS (SELECT 1 FROM catalog.projects project WHERE project.project_id = NEW.object_id) THEN
        RAISE EXCEPTION 'EVIDENCE_PROJECT_TARGET_MISMATCH' USING ERRCODE = '23514';
      END IF;
    WHEN 'version' THEN
      IF NEW.version_id IS DISTINCT FROM NEW.object_id OR NEW.project_id IS NULL OR NEW.event_id IS NOT NULL
         OR NOT EXISTS (
           SELECT 1 FROM catalog.project_versions version
             WHERE version.version_id = NEW.object_id AND version.project_id = NEW.project_id
         ) THEN
        RAISE EXCEPTION 'EVIDENCE_VERSION_TARGET_MISMATCH' USING ERRCODE = '23514';
      END IF;
    WHEN 'event' THEN
      IF NEW.event_id IS DISTINCT FROM NEW.object_id OR NEW.project_id IS NULL
         OR NOT EXISTS (
           SELECT 1 FROM catalog.events event
             WHERE event.event_id = NEW.object_id AND event.project_id = NEW.project_id
         ) THEN
        RAISE EXCEPTION 'EVIDENCE_EVENT_TARGET_MISMATCH' USING ERRCODE = '23514';
      END IF;
    WHEN 'asset' THEN
      IF NEW.project_id IS NULL OR NEW.version_id IS NOT NULL OR NEW.event_id IS NOT NULL
         OR NOT EXISTS (
           SELECT 1 FROM catalog.assets asset
             WHERE asset.asset_id = NEW.object_id AND asset.project_id = NEW.project_id
         ) THEN
        RAISE EXCEPTION 'EVIDENCE_ASSET_TARGET_MISMATCH' USING ERRCODE = '23514';
      END IF;
    WHEN 'relation' THEN
      IF NEW.project_id IS NULL OR NEW.version_id IS NOT NULL OR NEW.event_id IS NOT NULL
         OR NOT EXISTS (
           SELECT 1 FROM catalog.relations relation
             WHERE relation.relation_id = NEW.object_id
               AND NEW.project_id IN (relation.subject_project_id, relation.object_project_id)
         ) THEN
        RAISE EXCEPTION 'EVIDENCE_RELATION_TARGET_MISMATCH' USING ERRCODE = '23514';
      END IF;
    WHEN 'creator' THEN
      IF NEW.project_id IS NOT NULL OR NEW.version_id IS NOT NULL OR NEW.event_id IS NOT NULL
         OR NOT EXISTS (SELECT 1 FROM catalog.creators creator WHERE creator.creator_id = NEW.object_id) THEN
        RAISE EXCEPTION 'EVIDENCE_CREATOR_TARGET_MISMATCH' USING ERRCODE = '23514';
      END IF;
    WHEN 'author_relation' THEN
      IF NEW.project_id IS NULL OR NEW.version_id IS NOT NULL OR NEW.event_id IS NOT NULL
         OR NOT EXISTS (
           SELECT 1 FROM catalog.author_relations relation
             WHERE relation.author_relation_id = NEW.object_id AND relation.project_id = NEW.project_id
         ) THEN
        RAISE EXCEPTION 'EVIDENCE_AUTHOR_RELATION_TARGET_MISMATCH' USING ERRCODE = '23514';
      END IF;
  END CASE;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evidence_target_valid ON catalog.evidence;
CREATE TRIGGER evidence_target_valid
  BEFORE INSERT OR UPDATE OF object_type, object_id, project_id, version_id, event_id
  ON catalog.evidence
  FOR EACH ROW EXECUTE FUNCTION catalog.validate_evidence_target();

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

UPDATE taxonomy.category_schema_versions
SET search_field_map = '{
  "keyword":["core_problem","practice_formats","feedback_methods","learning_records","login_requirement","sharing_capability"],
  "filters":["target_users","use_scenarios","main_inputs","main_outputs"]
}'::jsonb
WHERE category_id = 'ai_learning_quiz'
  AND schema_version = 'learning.v1';

UPDATE taxonomy.category_schema_versions
SET search_field_map = '{
  "keyword":["project_showcase_format","case_study_depth","visual_styles","layout_patterns","color_character","theme_mode","interaction_level","interaction_patterns","responsive_support","blog_support"],
  "filters":["site_type","creator_roles","primary_goals","page_model","core_modules"]
}'::jsonb
WHERE category_id = 'personal_site_portfolio'
  AND schema_version = 'portfolio.v1';

DO $$
DECLARE
  configured_count integer;
BEGIN
  SELECT count(*)::integer INTO configured_count
  FROM taxonomy.category_schema_versions
  WHERE status = 'published'
    AND (
      (category_id = 'ai_learning_quiz' AND schema_version = 'learning.v1'
        AND search_field_map->'filters' =
          '["target_users","use_scenarios","main_inputs","main_outputs"]'::jsonb)
      OR
      (category_id = 'personal_site_portfolio' AND schema_version = 'portfolio.v1'
        AND search_field_map->'filters' =
          '["site_type","creator_roles","primary_goals","page_model","core_modules"]'::jsonb)
    );
  IF configured_count <> 2 THEN
    RAISE EXCEPTION 'SEARCH_FIELD_MAP_BASELINE_MISSING' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS project_documents_structured_idx
  ON search.project_documents USING gin (structured_json jsonb_path_ops);

CREATE INDEX IF NOT EXISTS projects_search_filter_idx
  ON catalog.projects (
    category_id, review_status, access_status, last_verified_at DESC, project_id
  );

ALTER TABLE search.project_documents
  DROP CONSTRAINT IF EXISTS project_documents_structured_identity_valid;
ALTER TABLE search.project_documents
  ADD CONSTRAINT project_documents_structured_identity_valid CHECK (
    structured_json ? 'category_id'
    AND structured_json->>'category_id' = category_id
    AND structured_json ? 'project_core'
    AND structured_json ? 'category_data'
    AND structured_json ? 'category_schema_version'
  );

CREATE OR REPLACE FUNCTION search.validate_project_document_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_record record;
BEGIN
  SELECT version.project_id,version.category_id,version.category_schema_version,
    project.category_id AS project_category_id,
    project.category_schema_version AS project_schema_version
  INTO source_record
  FROM catalog.project_versions version
  JOIN catalog.projects project ON project.project_id=version.project_id
  WHERE version.version_id=NEW.version_id;

  IF source_record.project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'SEARCH_DOCUMENT_PROJECT_VERSION_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF source_record.category_id IS DISTINCT FROM NEW.category_id
     OR source_record.project_category_id IS DISTINCT FROM NEW.category_id
     OR source_record.category_schema_version IS DISTINCT FROM
       NEW.structured_json->>'category_schema_version'
     OR source_record.project_schema_version IS DISTINCT FROM
       NEW.structured_json->>'category_schema_version' THEN
    RAISE EXCEPTION 'SEARCH_DOCUMENT_CATEGORY_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_documents_identity_guard ON search.project_documents;
CREATE TRIGGER project_documents_identity_guard
  BEFORE INSERT OR UPDATE OF project_id,version_id,category_id,structured_json
  ON search.project_documents
  FOR EACH ROW EXECUTE FUNCTION search.validate_project_document_identity();

CREATE TABLE IF NOT EXISTS catalog.link_permission_profiles (
  profile_id varchar(32) NOT NULL,
  profile_version integer NOT NULL,
  profile_family varchar(16) NOT NULL,
  capabilities_json jsonb NOT NULL,
  field_path_ceiling_json jsonb NOT NULL,
  config_hash char(64) NOT NULL,
  deployed_at timestamptz NOT NULL,
  PRIMARY KEY (profile_id,profile_version),
  CHECK (profile_version = 1),
  CHECK (
    (profile_id='OWNER_V1' AND profile_family='owner') OR
    (profile_id='MANAGER_V1' AND profile_family='manager')
  ),
  CHECK (jsonb_typeof(capabilities_json)='array'),
  CHECK (jsonb_typeof(field_path_ceiling_json)='array'),
  CHECK (jsonb_array_length(field_path_ceiling_json)=43),
  CHECK (config_hash ~ '^[a-f0-9]{64}$')
);

CREATE OR REPLACE FUNCTION catalog.compute_link_permission_profile_hash(
  profile_id text,
  profile_family text,
  profile_version integer,
  capabilities jsonb,
  field_paths jsonb
) RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  WITH capability_values AS (
    SELECT string_agg(to_jsonb(value)::text,',' ORDER BY value) AS encoded
    FROM jsonb_array_elements_text(capabilities) value
  ), field_values AS (
    SELECT string_agg(to_jsonb(value)::text,',' ORDER BY value) AS encoded
    FROM jsonb_array_elements_text(field_paths) value
  )
  SELECT encode(digest(convert_to(
    '{"capabilities":[' || coalesce(capability_values.encoded,'') ||
    '],"field_path_ceiling":[' || coalesce(field_values.encoded,'') ||
    '],"profile_family":' || to_jsonb(profile_family)::text ||
    ',"profile_id":' || to_jsonb(profile_id)::text ||
    ',"profile_version":' || profile_version::text || '}',
    'UTF8'
  ),'sha256'),'hex')
  FROM capability_values,field_values;
$$;

INSERT INTO catalog.link_permission_profiles (
  profile_id,profile_version,profile_family,capabilities_json,
  field_path_ceiling_json,config_hash,deployed_at
) VALUES
(
  'OWNER_V1',1,'owner',
  '["ownership.view","project_update.create","project_update.submit"]'::jsonb,
  '["/category_data/blog_support","/category_data/case_study_depth","/category_data/color_character","/category_data/content_processing","/category_data/core_features","/category_data/core_flow","/category_data/core_modules","/category_data/core_problem","/category_data/creator_roles","/category_data/differentiation","/category_data/feedback_methods","/category_data/homepage_sequence","/category_data/interaction_level","/category_data/interaction_patterns","/category_data/layout_patterns","/category_data/learning_records","/category_data/login_requirement","/category_data/main_inputs","/category_data/main_outputs","/category_data/navigation_pattern","/category_data/page_model","/category_data/practice_formats","/category_data/primary_goals","/category_data/project_showcase_format","/category_data/responsive_support","/category_data/secondary_features","/category_data/sharing_capability","/category_data/site_type","/category_data/target_users","/category_data/theme_mode","/category_data/use_scenarios","/category_data/visual_styles","/project_core/access_status","/project_core/ai_coding_tools","/project_core/cover_media_reference_ids","/project_core/current_name","/project_core/deployment_platform","/project_core/one_line_definition","/project_core/original_platform","/project_core/public_url","/project_core/repository_url","/project_core/status_note","/project_core/tech_stack"]'::jsonb,
  '8d9ca77abf8c83611d8eed83bba8318807db6d9c4bd69d6d93f1c83014c69a7c',now()
),
(
  'MANAGER_V1',1,'manager',
  '["project_update.create","project_update.submit"]'::jsonb,
  '["/category_data/blog_support","/category_data/case_study_depth","/category_data/color_character","/category_data/content_processing","/category_data/core_features","/category_data/core_flow","/category_data/core_modules","/category_data/core_problem","/category_data/creator_roles","/category_data/differentiation","/category_data/feedback_methods","/category_data/homepage_sequence","/category_data/interaction_level","/category_data/interaction_patterns","/category_data/layout_patterns","/category_data/learning_records","/category_data/login_requirement","/category_data/main_inputs","/category_data/main_outputs","/category_data/navigation_pattern","/category_data/page_model","/category_data/practice_formats","/category_data/primary_goals","/category_data/project_showcase_format","/category_data/responsive_support","/category_data/secondary_features","/category_data/sharing_capability","/category_data/site_type","/category_data/target_users","/category_data/theme_mode","/category_data/use_scenarios","/category_data/visual_styles","/project_core/access_status","/project_core/ai_coding_tools","/project_core/cover_media_reference_ids","/project_core/current_name","/project_core/deployment_platform","/project_core/one_line_definition","/project_core/original_platform","/project_core/public_url","/project_core/repository_url","/project_core/status_note","/project_core/tech_stack"]'::jsonb,
  '72f2b162c65ff2d145cb9f38407653b18906e067dd3c43afda8c1a524f56165d',now()
)
ON CONFLICT (profile_id,profile_version) DO NOTHING;

DO $$
DECLARE invalid_count integer;
BEGIN
  SELECT count(*)::int INTO invalid_count
  FROM catalog.link_permission_profiles profile
  WHERE profile.profile_version<>1
     OR profile.config_hash<>catalog.compute_link_permission_profile_hash(
       profile.profile_id,profile.profile_family,profile.profile_version,
       profile.capabilities_json,profile.field_path_ceiling_json
     )
     OR jsonb_array_length(profile.capabilities_json)<>(
       SELECT count(DISTINCT value) FROM jsonb_array_elements_text(profile.capabilities_json) value
     )
     OR jsonb_array_length(profile.field_path_ceiling_json)<>(
       SELECT count(DISTINCT value) FROM jsonb_array_elements_text(profile.field_path_ceiling_json) value
     );
  IF invalid_count<>0 OR (SELECT count(*) FROM catalog.link_permission_profiles)<>2 THEN
    RAISE EXCEPTION 'LINK_PERMISSION_PROFILE_INVALID' USING ERRCODE='23514';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS link_permission_profiles_immutable
  ON catalog.link_permission_profiles;
CREATE TRIGGER link_permission_profiles_immutable
  BEFORE UPDATE OR DELETE ON catalog.link_permission_profiles
  FOR EACH ROW EXECUTE FUNCTION catalog.reject_immutable_mutation();

ALTER TABLE catalog.link_permission_profiles
  ADD CONSTRAINT link_permission_profiles_exact_ref_uniq
  UNIQUE (profile_id,profile_version,config_hash);

CREATE TABLE IF NOT EXISTS catalog.creator_account_links (
  creator_account_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES iam.users(user_id),
  creator_id uuid NOT NULL REFERENCES catalog.creators(creator_id),
  link_role varchar(16) NOT NULL CHECK (link_role IN ('owner','manager')),
  permission_profile_id varchar(32) NOT NULL,
  permission_profile_version integer NOT NULL,
  permission_profile_config_hash char(64) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','suspended','terminated')),
  source_verification_id uuid NOT NULL,
  replacement_link_id uuid REFERENCES catalog.creator_account_links(creator_account_link_id),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (
    permission_profile_id,permission_profile_version,permission_profile_config_hash
  ) REFERENCES catalog.link_permission_profiles(profile_id,profile_version,config_hash),
  CHECK (updated_at >= created_at),
  CHECK ((status='terminated') OR replacement_link_id IS NULL)
);

CREATE UNIQUE INDEX creator_account_links_user_creator_nonterminal_uniq
  ON catalog.creator_account_links (user_id,creator_id)
  WHERE status IN ('active','suspended');

CREATE UNIQUE INDEX creator_account_links_owner_nonterminal_uniq
  ON catalog.creator_account_links (creator_id)
  WHERE link_role='owner' AND status IN ('active','suspended');

CREATE INDEX creator_account_links_user_status_idx
  ON catalog.creator_account_links (user_id,status,creator_id);

CREATE UNIQUE INDEX author_relations_creator_project_role_nonterminal_uniq
  ON catalog.author_relations (creator_id,project_id,author_role)
  WHERE status IN ('active','suspended');

CREATE OR REPLACE FUNCTION catalog.author_relation_field_permissions_valid(field_paths jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
STRICT
AS $$
  SELECT jsonb_typeof(field_paths)='array'
     AND jsonb_array_length(field_paths)=(
       SELECT count(DISTINCT requested.value)
         FROM jsonb_array_elements_text(field_paths) AS requested(value)
     )
     AND NOT EXISTS (
       SELECT requested.value
         FROM jsonb_array_elements_text(field_paths) AS requested(value)
       EXCEPT
       SELECT deployed.value
         FROM catalog.link_permission_profiles profile,
              jsonb_array_elements_text(profile.field_path_ceiling_json) deployed(value)
     );
$$;

ALTER TABLE catalog.author_relations
  ADD CONSTRAINT author_relations_field_permissions_valid
  CHECK (catalog.author_relation_field_permissions_valid(field_permissions_json));

CREATE OR REPLACE FUNCTION catalog.validate_creator_account_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  stored_family text;
  creator_is_canonical boolean;
BEGIN
  SELECT profile_family INTO stored_family
    FROM catalog.link_permission_profiles
   WHERE profile_id=NEW.permission_profile_id
     AND profile_version=NEW.permission_profile_version
     AND config_hash=NEW.permission_profile_config_hash;
  IF stored_family IS NULL OR stored_family<>NEW.link_role THEN
    RAISE EXCEPTION 'CREATOR_ACCOUNT_LINK_PROFILE_MISMATCH' USING ERRCODE='23514';
  END IF;

  SELECT canonical_creator_id IS NULL INTO creator_is_canonical
    FROM catalog.creators WHERE creator_id=NEW.creator_id;
  IF creator_is_canonical IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CREATOR_ACCOUNT_LINK_CREATOR_NOT_CANONICAL' USING ERRCODE='23514';
  END IF;

  IF TG_OP='UPDATE' THEN
    IF NEW.user_id<>OLD.user_id
       OR NEW.creator_id<>OLD.creator_id
       OR NEW.link_role<>OLD.link_role
       OR NEW.permission_profile_id<>OLD.permission_profile_id
       OR NEW.permission_profile_version<>OLD.permission_profile_version
       OR NEW.permission_profile_config_hash<>OLD.permission_profile_config_hash
       OR NEW.source_verification_id<>OLD.source_verification_id
       OR NEW.created_at<>OLD.created_at THEN
      RAISE EXCEPTION 'CREATOR_ACCOUNT_LINK_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
    END IF;
    IF NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at THEN
      RAISE EXCEPTION 'CREATOR_ACCOUNT_LINK_VERSION_INVALID' USING ERRCODE='23514';
    END IF;
    IF NOT (
      (OLD.status='active' AND NEW.status IN ('active','suspended','terminated')) OR
      (OLD.status='suspended' AND NEW.status IN ('active','suspended','terminated')) OR
      (OLD.status='terminated' AND NEW.status='terminated')
    ) THEN
      RAISE EXCEPTION 'CREATOR_ACCOUNT_LINK_TRANSITION_INVALID' USING ERRCODE='23514';
    END IF;
    IF OLD.status='terminated' AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'CREATOR_ACCOUNT_LINK_TERMINAL_IMMUTABLE' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER creator_account_links_validate
  BEFORE INSERT OR UPDATE ON catalog.creator_account_links
  FOR EACH ROW EXECUTE FUNCTION catalog.validate_creator_account_link();

CREATE TRIGGER creator_account_links_no_delete
  BEFORE DELETE ON catalog.creator_account_links
  FOR EACH ROW EXECUTE FUNCTION catalog.reject_immutable_mutation();

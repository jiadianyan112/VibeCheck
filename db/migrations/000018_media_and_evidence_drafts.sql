CREATE TABLE IF NOT EXISTS media.media_resources (
  media_resource_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  purpose varchar(64) NOT NULL CHECK (purpose ~ '^[a-z][a-z0-9_]{0,63}$'),
  storage_key varchar(512) NOT NULL UNIQUE,
  declared_mime varchar(128) NOT NULL,
  detected_mime varchar(128),
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  checksum_sha256 char(64) NOT NULL CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  source varchar(32) NOT NULL DEFAULT 'upload' CHECK (source IN ('upload','migration')),
  status varchar(16) NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','uploading','uploaded','scanning','processing','ready','rejected','deleted')),
  scan_result varchar(16) NOT NULL DEFAULT 'not_scanned'
    CHECK (scan_result IN ('not_scanned','clean','malicious','unscannable')),
  rejection_reason_code varchar(64),
  pre_delete_scan_result varchar(16)
    CHECK (pre_delete_scan_result IS NULL OR pre_delete_scan_result IN ('not_scanned','clean','malicious','unscannable')),
  scan_attempt_count integer NOT NULL DEFAULT 0 CHECK (scan_attempt_count >= 0),
  next_scan_at timestamptz,
  exif_removed boolean NOT NULL DEFAULT false,
  deletion_guard_job_id uuid,
  deletion_guard_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  idempotency_key varchar(128) NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (owner_user_id,idempotency_key),
  CHECK (declared_mime = lower(declared_mime)),
  CHECK ((deletion_guard_job_id IS NULL) = (deletion_guard_at IS NULL)),
  CHECK (
    (status IN ('created','uploading','uploaded','scanning') AND scan_result='not_scanned') OR
    (status IN ('processing','ready') AND scan_result='clean') OR
    (status='rejected') OR
    (status='deleted' AND pre_delete_scan_result IS NOT NULL)
  ),
  CHECK ((status='ready' AND detected_mime IS NOT NULL) OR status<>'ready'),
  CHECK ((status='ready' AND exif_removed) OR status<>'ready' OR declared_mime NOT LIKE 'image/%'),
  CHECK ((status='rejected') = (rejection_reason_code IS NOT NULL)),
  CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS media_resources_owner_status_idx
  ON media.media_resources (owner_user_id,status,updated_at DESC,media_resource_id);

CREATE INDEX IF NOT EXISTS media_resources_scan_queue_idx
  ON media.media_resources (status,next_scan_at,media_resource_id)
  WHERE status IN ('uploaded','scanning','processing');

CREATE INDEX IF NOT EXISTS media_resources_owner_checksum_idx
  ON media.media_resources (owner_user_id,checksum_sha256,status);

CREATE TABLE IF NOT EXISTS media.media_upload_parts (
  media_resource_id uuid NOT NULL REFERENCES media.media_resources(media_resource_id),
  upload_id varchar(512) NOT NULL,
  part_number integer NOT NULL CHECK (part_number BETWEEN 1 AND 10000),
  part_checksum char(64) NOT NULL CHECK (part_checksum ~ '^[a-f0-9]{64}$'),
  part_etag_ciphertext bytea NOT NULL,
  completed_at timestamptz NOT NULL,
  PRIMARY KEY (media_resource_id,part_number)
);

CREATE TABLE IF NOT EXISTS media.media_references (
  media_reference_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_resource_id uuid NOT NULL REFERENCES media.media_resources(media_resource_id),
  target_type varchar(64) NOT NULL CHECK (target_type IN (
    'submission_draft','admin_project_creation_draft','admin_project_edit_draft',
    'project_update','creator_profile_draft','project_version','creator_profile_version'
  )),
  target_id uuid NOT NULL,
  role varchar(64) NOT NULL CHECK (role ~ '^[a-z][a-z0-9_]{0,63}$'),
  alt_text varchar(200) NOT NULL CHECK (char_length(alt_text) BETWEEN 1 AND 200),
  sort_order integer NOT NULL CHECK (sort_order BETWEEN 0 AND 999),
  crop_focus_json jsonb,
  variant varchar(128),
  source_media_reference_id uuid REFERENCES media.media_references(media_reference_id),
  lifecycle_status varchar(16) NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active','unlinked')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  unlinked_at timestamptz,
  CHECK (crop_focus_json IS NULL OR jsonb_typeof(crop_focus_json)='object'),
  CHECK (variant IS NULL OR variant ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
  CHECK ((lifecycle_status='unlinked') = (unlinked_at IS NOT NULL)),
  CHECK (
    (target_type IN ('project_version','creator_profile_version') AND source_media_reference_id IS NOT NULL) OR
    (target_type NOT IN ('project_version','creator_profile_version') AND source_media_reference_id IS NULL)
  ),
  CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS media_references_active_role_order_idx
  ON media.media_references (target_type,target_id,role,sort_order)
  WHERE lifecycle_status='active';

CREATE INDEX IF NOT EXISTS media_references_target_idx
  ON media.media_references (target_type,target_id,lifecycle_status,role,sort_order,media_reference_id);

CREATE INDEX IF NOT EXISTS media_references_resource_idx
  ON media.media_references (media_resource_id,lifecycle_status);

CREATE TABLE IF NOT EXISTS media.media_reference_operation_receipts (
  owner_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  operation_id varchar(128) NOT NULL,
  operation_type varchar(16) NOT NULL CHECK (operation_type IN ('create','patch','delete')),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  media_reference_id uuid NOT NULL REFERENCES media.media_references(media_reference_id),
  response_json jsonb NOT NULL CHECK (jsonb_typeof(response_json)='object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_user_id,operation_id)
);

CREATE TABLE IF NOT EXISTS workflow.evidence_drafts (
  evidence_draft_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  collector_actor_type varchar(32) NOT NULL
    CHECK (collector_actor_type IN ('system','platform_editor','verified_author','user')),
  parent_type varchar(64) NOT NULL CHECK (parent_type IN (
    'submission_draft','admin_project_creation_draft','admin_project_edit_draft',
    'project_update','relation_candidate'
  )),
  parent_id uuid NOT NULL,
  final_target_kind varchar(16) NOT NULL
    CHECK (final_target_kind IN ('project','version','event','asset','relation')),
  target_asset_draft_key varchar(128),
  evidence_type varchar(64) NOT NULL CHECK (evidence_type IN (
    'platform_verified_fact','verified_author_statement','trusted_external_source','system_inference'
  )),
  source_channel varchar(32) NOT NULL CHECK (source_channel IN (
    'official_site','repository','release_note','media_report','author_statement','platform_check'
  )),
  field_path varchar(240),
  requested_visibility varchar(16) NOT NULL
    CHECK (requested_visibility IN ('public','reviewer_only','private')),
  source_url varchar(2048),
  internal_record_ref_ciphertext bytea,
  internal_record_ref_key_version varchar(64),
  text_excerpt varchar(2000),
  status varchar(16) NOT NULL DEFAULT 'editing'
    CHECK (status IN ('editing','ready','withdrawn','promoted','expired')),
  source_hash char(64) CHECK (source_hash IS NULL OR source_hash ~ '^[a-f0-9]{64}$'),
  final_field_preview_json jsonb,
  bound_at timestamptz,
  completed_at timestamptz,
  promoted_evidence_id uuid UNIQUE,
  client_request_id varchar(128) NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  withdrawn_at timestamptz,
  expired_at timestamptz,
  UNIQUE (owner_user_id,client_request_id),
  CHECK ((internal_record_ref_ciphertext IS NULL) = (internal_record_ref_key_version IS NULL)),
  CHECK (source_url IS NULL OR source_url ~* '^https?://'),
  CHECK (field_path IS NULL OR field_path ~ '^/'),
  CHECK ((final_target_kind='asset') = (target_asset_draft_key IS NOT NULL)),
  CHECK (
    (status IN ('ready','promoted') AND completed_at IS NOT NULL) OR
    (status IN ('editing','expired') AND completed_at IS NULL) OR
    status='withdrawn'
  ),
  CHECK ((status='promoted') = (promoted_evidence_id IS NOT NULL)),
  CHECK ((status='withdrawn') = (withdrawn_at IS NOT NULL)),
  CHECK ((status='expired') = (expired_at IS NOT NULL)),
  CHECK (final_field_preview_json IS NULL OR jsonb_typeof(final_field_preview_json)='object'),
  CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS evidence_drafts_parent_idx
  ON workflow.evidence_drafts (parent_type,parent_id,status,evidence_draft_id);

CREATE INDEX IF NOT EXISTS evidence_drafts_owner_idx
  ON workflow.evidence_drafts (owner_user_id,status,updated_at DESC,evidence_draft_id);

CREATE TABLE IF NOT EXISTS workflow.evidence_draft_snapshots (
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_draft_id uuid NOT NULL REFERENCES workflow.evidence_drafts(evidence_draft_id),
  evidence_draft_version integer NOT NULL CHECK (evidence_draft_version >= 1),
  snapshot_json jsonb NOT NULL CHECK (jsonb_typeof(snapshot_json)='object'),
  source_hash char(64) NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  created_by_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  created_at timestamptz NOT NULL,
  UNIQUE (evidence_draft_id,evidence_draft_version)
);

CREATE TABLE IF NOT EXISTS workflow.evidence_attachment_drafts (
  attachment_draft_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_draft_id uuid NOT NULL REFERENCES workflow.evidence_drafts(evidence_draft_id),
  media_resource_id uuid NOT NULL REFERENCES media.media_resources(media_resource_id),
  role varchar(32) NOT NULL CHECK (role IN ('supporting_document','supporting_image')),
  requested_visibility varchar(16) NOT NULL
    CHECK (requested_visibility IN ('public','reviewer_only','private')),
  status varchar(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','withdrawn','promoted','expired')),
  promoted_attachment_id uuid UNIQUE,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  client_request_id varchar(128) NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  withdrawn_at timestamptz,
  expired_at timestamptz,
  UNIQUE (evidence_draft_id,client_request_id),
  CHECK ((status='promoted') = (promoted_attachment_id IS NOT NULL)),
  CHECK ((status='withdrawn') = (withdrawn_at IS NOT NULL)),
  CHECK ((status='expired') = (expired_at IS NOT NULL)),
  CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS evidence_attachment_drafts_parent_idx
  ON workflow.evidence_attachment_drafts (evidence_draft_id,status,attachment_draft_id);

CREATE INDEX IF NOT EXISTS evidence_attachment_drafts_resource_idx
  ON workflow.evidence_attachment_drafts (media_resource_id,status);

CREATE TABLE IF NOT EXISTS workflow.evidence_draft_operation_receipts (
  owner_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  operation_id varchar(128) NOT NULL,
  operation_type varchar(16) NOT NULL CHECK (operation_type IN (
    'patch','bind','complete','withdraw','attach','detach'
  )),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  evidence_draft_id uuid NOT NULL REFERENCES workflow.evidence_drafts(evidence_draft_id),
  response_json jsonb NOT NULL CHECK (jsonb_typeof(response_json)='object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_user_id,operation_id)
);

CREATE OR REPLACE FUNCTION workflow.reject_evidence_draft_reopen()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF
    NEW.evidence_draft_id IS DISTINCT FROM OLD.evidence_draft_id OR
    NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR
    NEW.collector_actor_type IS DISTINCT FROM OLD.collector_actor_type OR
    NEW.parent_type IS DISTINCT FROM OLD.parent_type OR
    NEW.parent_id IS DISTINCT FROM OLD.parent_id OR
    NEW.final_target_kind IS DISTINCT FROM OLD.final_target_kind OR
    NEW.target_asset_draft_key IS DISTINCT FROM OLD.target_asset_draft_key OR
    NEW.evidence_type IS DISTINCT FROM OLD.evidence_type OR
    NEW.source_channel IS DISTINCT FROM OLD.source_channel OR
    NEW.client_request_id IS DISTINCT FROM OLD.client_request_id OR
    NEW.request_hash IS DISTINCT FROM OLD.request_hash OR
    NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'EVIDENCE_DRAFT_IDENTITY_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  IF OLD.status <> 'editing' AND NEW.status = 'editing' THEN
    RAISE EXCEPTION 'EVIDENCE_DRAFT_REOPEN_FORBIDDEN' USING ERRCODE='23514';
  END IF;
  IF OLD.status <> 'editing' AND (
    NEW.field_path IS DISTINCT FROM OLD.field_path OR
    NEW.requested_visibility IS DISTINCT FROM OLD.requested_visibility OR
    NEW.source_url IS DISTINCT FROM OLD.source_url OR
    NEW.internal_record_ref_ciphertext IS DISTINCT FROM OLD.internal_record_ref_ciphertext OR
    NEW.internal_record_ref_key_version IS DISTINCT FROM OLD.internal_record_ref_key_version OR
    NEW.text_excerpt IS DISTINCT FROM OLD.text_excerpt OR
    NEW.bound_at IS DISTINCT FROM OLD.bound_at
  ) THEN
    RAISE EXCEPTION 'EVIDENCE_DRAFT_CONTENT_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evidence_draft_no_reopen ON workflow.evidence_drafts;
CREATE TRIGGER evidence_draft_no_reopen
  BEFORE UPDATE ON workflow.evidence_drafts
  FOR EACH ROW EXECUTE FUNCTION workflow.reject_evidence_draft_reopen();

CREATE OR REPLACE FUNCTION workflow.reject_evidence_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'EVIDENCE_DRAFT_SNAPSHOT_IMMUTABLE' USING ERRCODE='55000';
END;
$$;

DROP TRIGGER IF EXISTS evidence_draft_snapshot_immutable ON workflow.evidence_draft_snapshots;
CREATE TRIGGER evidence_draft_snapshot_immutable
  BEFORE UPDATE OR DELETE ON workflow.evidence_draft_snapshots
  FOR EACH ROW EXECUTE FUNCTION workflow.reject_evidence_snapshot_mutation();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='evidence_source_draft_fk' AND conrelid='catalog.evidence'::regclass
  ) THEN
    ALTER TABLE catalog.evidence
      ADD CONSTRAINT evidence_source_draft_fk
      FOREIGN KEY (source_evidence_draft_id)
      REFERENCES workflow.evidence_drafts(evidence_draft_id) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='evidence_attachment_resource_fk'
      AND conrelid='catalog.evidence_attachments'::regclass
  ) THEN
    ALTER TABLE catalog.evidence_attachments
      ADD CONSTRAINT evidence_attachment_resource_fk
      FOREIGN KEY (media_resource_id)
      REFERENCES media.media_resources(media_resource_id) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='evidence_attachment_source_draft_fk'
      AND conrelid='catalog.evidence_attachments'::regclass
  ) THEN
    ALTER TABLE catalog.evidence_attachments
      ADD CONSTRAINT evidence_attachment_source_draft_fk
      FOREIGN KEY (source_attachment_draft_id)
      REFERENCES workflow.evidence_attachment_drafts(attachment_draft_id) NOT VALID;
  END IF;
END;
$$;

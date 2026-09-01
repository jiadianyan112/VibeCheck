CREATE TABLE IF NOT EXISTS comparison.active_comparisons (
  active_comparison_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES iam.users(user_id),
  anonymous_subject_hash bytea,
  comparison_id uuid NOT NULL UNIQUE REFERENCES comparison.comparisons(comparison_id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_user_id IS NOT NULL) <> (anonymous_subject_hash IS NOT NULL)),
  CHECK (anonymous_subject_hash IS NULL OR octet_length(anonymous_subject_hash) = 32)
);

CREATE UNIQUE INDEX IF NOT EXISTS active_comparisons_user_owner_uniq
  ON comparison.active_comparisons (owner_user_id)
  WHERE owner_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS active_comparisons_anonymous_owner_uniq
  ON comparison.active_comparisons (anonymous_subject_hash)
  WHERE anonymous_subject_hash IS NOT NULL;

-- Existing production comparisons predate the explicit active pointer. The most
-- recently updated active comparison is the only deterministic representation of
-- the already frozen "single active comparison" rule during this one-time backfill.
INSERT INTO comparison.active_comparisons (
  owner_user_id,anonymous_subject_hash,comparison_id,updated_at
)
SELECT ranked.owner_user_id,ranked.anonymous_subject_hash,ranked.comparison_id,ranked.updated_at
FROM (
  SELECT source.*,
    row_number() OVER (
      PARTITION BY source.owner_user_id
      ORDER BY source.updated_at DESC,source.comparison_id DESC
    ) AS owner_rank
  FROM comparison.comparisons source
  WHERE source.owner_user_id IS NOT NULL AND source.status='active'
) ranked
WHERE ranked.owner_rank=1
ON CONFLICT DO NOTHING;

INSERT INTO comparison.active_comparisons (
  owner_user_id,anonymous_subject_hash,comparison_id,updated_at
)
SELECT ranked.owner_user_id,ranked.anonymous_subject_hash,ranked.comparison_id,ranked.updated_at
FROM (
  SELECT source.*,
    row_number() OVER (
      PARTITION BY source.anonymous_subject_hash
      ORDER BY source.updated_at DESC,source.comparison_id DESC
    ) AS owner_rank
  FROM comparison.comparisons source
  WHERE source.anonymous_subject_hash IS NOT NULL AND source.status='active'
) ranked
WHERE ranked.owner_rank=1
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION comparison.uuid_array_is_unique(value uuid[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT cardinality(value) = count(DISTINCT item)
  FROM unnest(value) AS item;
$$;

CREATE TABLE IF NOT EXISTS comparison.comparison_merge_conflicts (
  conflict_id uuid PRIMARY KEY,
  identity_link_id uuid NOT NULL UNIQUE REFERENCES iam.identity_links(identity_link_id),
  user_id uuid NOT NULL REFERENCES iam.users(user_id),
  account_comparison_id uuid NOT NULL REFERENCES comparison.comparisons(comparison_id),
  account_comparison_version integer NOT NULL CHECK (account_comparison_version >= 1),
  anonymous_comparison_id uuid NOT NULL REFERENCES comparison.comparisons(comparison_id),
  anonymous_comparison_version integer NOT NULL CHECK (anonymous_comparison_version >= 1),
  candidate_project_ids uuid[] NOT NULL,
  selected_project_ids uuid[],
  pending_action_id uuid,
  status varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','resolved','cancelled','expired')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  expires_at timestamptz NOT NULL,
  resolved_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason varchar(128),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(candidate_project_ids) BETWEEN 6 AND 10),
  CHECK (comparison.uuid_array_is_unique(candidate_project_ids)),
  CHECK (selected_project_ids IS NULL OR cardinality(selected_project_ids) BETWEEN 0 AND 5),
  CHECK (selected_project_ids IS NULL OR comparison.uuid_array_is_unique(selected_project_ids)),
  CHECK (expires_at > created_at),
  CHECK (
    (status='pending' AND selected_project_ids IS NULL AND resolved_at IS NULL AND cancelled_at IS NULL)
    OR (status='resolved' AND selected_project_ids IS NOT NULL AND resolved_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status='cancelled' AND resolved_at IS NULL AND cancelled_at IS NOT NULL)
    OR (status='expired' AND resolved_at IS NULL AND cancelled_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS comparison_merge_conflicts_user_status_idx
  ON comparison.comparison_merge_conflicts (user_id,status,expires_at DESC);

CREATE INDEX IF NOT EXISTS comparison_merge_conflicts_expiry_idx
  ON comparison.comparison_merge_conflicts (expires_at)
  WHERE status='pending';

CREATE TABLE IF NOT EXISTS comparison.comparison_login_merge_receipts (
  identity_link_id uuid PRIMARY KEY REFERENCES iam.identity_links(identity_link_id),
  operation_id uuid NOT NULL,
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comparison.comparison_merge_operation_receipts (
  conflict_id uuid NOT NULL REFERENCES comparison.comparison_merge_conflicts(conflict_id),
  operation_id uuid NOT NULL,
  operation_type varchar(16) NOT NULL CHECK (operation_type IN ('resolve','cancel')),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conflict_id,operation_id)
);

CREATE OR REPLACE FUNCTION comparison.guard_comparison_merge_terminal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.conflict_id IS DISTINCT FROM NEW.conflict_id
     OR OLD.identity_link_id IS DISTINCT FROM NEW.identity_link_id
     OR OLD.user_id IS DISTINCT FROM NEW.user_id
     OR OLD.account_comparison_id IS DISTINCT FROM NEW.account_comparison_id
     OR OLD.account_comparison_version IS DISTINCT FROM NEW.account_comparison_version
     OR OLD.anonymous_comparison_id IS DISTINCT FROM NEW.anonymous_comparison_id
     OR OLD.anonymous_comparison_version IS DISTINCT FROM NEW.anonymous_comparison_version
     OR OLD.candidate_project_ids IS DISTINCT FROM NEW.candidate_project_ids
     OR OLD.pending_action_id IS DISTINCT FROM NEW.pending_action_id
     OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'IMMUTABLE_COMPARISON_MERGE_CONFLICT' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comparison_merge_conflicts_guard
  ON comparison.comparison_merge_conflicts;
CREATE TRIGGER comparison_merge_conflicts_guard
  BEFORE UPDATE OR DELETE ON comparison.comparison_merge_conflicts
  FOR EACH ROW EXECUTE FUNCTION comparison.guard_comparison_merge_terminal();

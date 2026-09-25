CREATE TABLE IF NOT EXISTS search.navigation_contexts (
  navigation_context_id uuid PRIMARY KEY,
  click_id uuid NOT NULL UNIQUE,
  click_request_id uuid NOT NULL,
  owner_subject_kind varchar(16) NOT NULL CHECK (owner_subject_kind IN ('anonymous','user')),
  owner_subject_hash bytea NOT NULL CHECK (octet_length(owner_subject_hash)=32),
  query_id uuid NOT NULL REFERENCES search.query_snapshots(query_id),
  result_version uuid NOT NULL REFERENCES search.result_versions(result_version),
  result_item_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES catalog.projects(project_id),
  position integer NOT NULL CHECK (position>=1),
  channel varchar(32) NOT NULL CHECK (channel IN ('search_exact','search_adjacent')),
  group_id varchar(32) NOT NULL CHECK (group_id IN ('exact','adjacent')),
  ranking_version varchar(64) NOT NULL,
  page_cursor_hash char(64) NOT NULL CHECK (page_cursor_hash~'^[0-9a-f]{64}$'),
  source_page varchar(4) NOT NULL CHECK (source_page IN ('P05','P07')),
  metric_subject_id uuid NOT NULL,
  subject_kind varchar(16) NOT NULL CHECK (subject_kind IN ('anonymous','user')),
  bridge_version integer NOT NULL CHECK (bridge_version>=1),
  request_hash char(64) NOT NULL CHECK (request_hash~'^[0-9a-f]{64}$'),
  transaction_id uuid NOT NULL UNIQUE,
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','consumed','expired')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE(owner_subject_hash,click_request_id),
  FOREIGN KEY(result_version,result_item_id)
    REFERENCES search.result_items(result_version,result_item_id),
  CHECK(owner_subject_kind=subject_kind),
  CHECK(expires_at>created_at),
  CHECK((status='active' AND consumed_at IS NULL) OR (status='consumed' AND consumed_at IS NOT NULL) OR status='expired')
);

CREATE INDEX IF NOT EXISTS search_navigation_context_owner_idx
  ON search.navigation_contexts(owner_subject_hash,status,expires_at);
CREATE INDEX IF NOT EXISTS search_navigation_context_project_idx
  ON search.navigation_contexts(project_id,status,expires_at);

CREATE OR REPLACE FUNCTION search.protect_navigation_context()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.navigation_context_id IS DISTINCT FROM OLD.navigation_context_id
     OR NEW.click_id IS DISTINCT FROM OLD.click_id
     OR NEW.click_request_id IS DISTINCT FROM OLD.click_request_id
     OR NEW.owner_subject_kind IS DISTINCT FROM OLD.owner_subject_kind
     OR NEW.owner_subject_hash IS DISTINCT FROM OLD.owner_subject_hash
     OR NEW.query_id IS DISTINCT FROM OLD.query_id
     OR NEW.result_version IS DISTINCT FROM OLD.result_version
     OR NEW.result_item_id IS DISTINCT FROM OLD.result_item_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.position IS DISTINCT FROM OLD.position
     OR NEW.channel IS DISTINCT FROM OLD.channel
     OR NEW.group_id IS DISTINCT FROM OLD.group_id
     OR NEW.ranking_version IS DISTINCT FROM OLD.ranking_version
     OR NEW.page_cursor_hash IS DISTINCT FROM OLD.page_cursor_hash
     OR NEW.source_page IS DISTINCT FROM OLD.source_page
     OR NEW.metric_subject_id IS DISTINCT FROM OLD.metric_subject_id
     OR NEW.subject_kind IS DISTINCT FROM OLD.subject_kind
     OR NEW.bridge_version IS DISTINCT FROM OLD.bridge_version
     OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
     OR NEW.transaction_id IS DISTINCT FROM OLD.transaction_id
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'SEARCH_NAVIGATION_CONTEXT_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  IF OLD.status<>'active' OR NEW.status NOT IN ('consumed','expired') THEN
    RAISE EXCEPTION 'SEARCH_NAVIGATION_CONTEXT_TRANSITION_INVALID' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS search_navigation_context_guard ON search.navigation_contexts;
CREATE TRIGGER search_navigation_context_guard
  BEFORE UPDATE OR DELETE ON search.navigation_contexts
  FOR EACH ROW EXECUTE FUNCTION search.protect_navigation_context();

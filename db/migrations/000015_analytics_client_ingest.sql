CREATE TABLE IF NOT EXISTS analytics.identity_bridge_events (
  bridge_event_id uuid PRIMARY KEY,
  metric_subject_id uuid NOT NULL,
  subject_kind varchar(16) NOT NULL CHECK (subject_kind IN ('user', 'anonymous')),
  subject_ref_hash bytea NOT NULL CHECK (octet_length(subject_ref_hash) = 32),
  bridge_version integer NOT NULL CHECK (bridge_version >= 1),
  link_action varchar(16) NOT NULL CHECK (link_action IN ('created', 'linked', 'revoked', 'deleted')),
  canonical_subject_id uuid,
  source_identity_link_id uuid REFERENCES iam.identity_links(identity_link_id),
  status varchar(16) NOT NULL CHECK (status IN ('active', 'linked', 'revoked', 'deleted')),
  effective_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_kind, subject_ref_hash, bridge_version),
  UNIQUE (metric_subject_id, subject_kind, bridge_version),
  CHECK (
    (link_action = 'linked' AND canonical_subject_id IS NOT NULL AND source_identity_link_id IS NOT NULL)
    OR (link_action <> 'linked' AND canonical_subject_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS analytics.events (
  event_id uuid PRIMARY KEY,
  event_name varchar(64) NOT NULL,
  event_version integer NOT NULL CHECK (event_version >= 1),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  app_version varchar(32) NOT NULL,
  environment varchar(16) NOT NULL CHECK (environment IN ('development', 'test', 'production')),
  actor_type varchar(16) NOT NULL CHECK (actor_type IN ('client', 'service')),
  page_id varchar(4),
  source_page varchar(4),
  request_id varchar(64),
  consent_state varchar(16) NOT NULL CHECK (consent_state IN ('granted', 'not_required', 'not_applicable')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  session_id_hash bytea,
  metric_subject_id uuid,
  subject_kind varchar(16),
  bridge_version integer,
  clock_skew_flag boolean,
  service_actor_id varchar(64),
  transaction_id uuid,
  payload_hash char(64) NOT NULL,
  CHECK (
    (
      actor_type = 'client'
      AND session_id_hash IS NOT NULL AND octet_length(session_id_hash) = 32
      AND metric_subject_id IS NOT NULL
      AND subject_kind IN ('user', 'anonymous')
      AND bridge_version IS NOT NULL
      AND service_actor_id IS NULL AND transaction_id IS NULL
    ) OR (
      actor_type = 'service'
      AND session_id_hash IS NULL AND metric_subject_id IS NULL
      AND subject_kind IS NULL AND bridge_version IS NULL AND clock_skew_flag IS NULL
      AND service_actor_id IS NOT NULL AND transaction_id IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS analytics_events_name_received_idx
  ON analytics.events (event_name, event_version, received_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_subject_idx
  ON analytics.events (metric_subject_id, subject_kind, bridge_version, occurred_at DESC)
  WHERE actor_type = 'client';

CREATE TABLE IF NOT EXISTS analytics.ingest_receipts (
  receipt_id uuid PRIMARY KEY,
  batch_hash char(64) NOT NULL,
  session_hash bytea NOT NULL CHECK (octet_length(session_hash) = 32),
  http_status smallint NOT NULL CHECK (http_status = 202),
  accepted_count smallint NOT NULL CHECK (accepted_count BETWEEN 0 AND 100),
  rejected_count smallint NOT NULL CHECK (rejected_count BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (accepted_count + rejected_count BETWEEN 1 AND 100)
);

CREATE TABLE IF NOT EXISTS analytics.ingest_items (
  receipt_id uuid NOT NULL REFERENCES analytics.ingest_receipts(receipt_id),
  item_index smallint NOT NULL CHECK (item_index BETWEEN 0 AND 99),
  event_id varchar(128) NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('accepted', 'deduplicated', 'rejected')),
  error_code varchar(64),
  payload_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (receipt_id, item_index),
  CHECK (
    (status = 'rejected' AND error_code IS NOT NULL)
    OR (status <> 'rejected' AND error_code IS NULL)
  )
);

CREATE OR REPLACE FUNCTION analytics.reject_immutable_analytics_fact()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_ANALYTICS_FACT' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS analytics_events_immutable ON analytics.events;
CREATE TRIGGER analytics_events_immutable
  BEFORE UPDATE OR DELETE ON analytics.events
  FOR EACH ROW EXECUTE FUNCTION analytics.reject_immutable_analytics_fact();

DROP TRIGGER IF EXISTS analytics_identity_bridge_events_immutable
  ON analytics.identity_bridge_events;
CREATE TRIGGER analytics_identity_bridge_events_immutable
  BEFORE UPDATE OR DELETE ON analytics.identity_bridge_events
  FOR EACH ROW EXECUTE FUNCTION analytics.reject_immutable_analytics_fact();

DROP TRIGGER IF EXISTS analytics_ingest_receipts_immutable ON analytics.ingest_receipts;
CREATE TRIGGER analytics_ingest_receipts_immutable
  BEFORE UPDATE OR DELETE ON analytics.ingest_receipts
  FOR EACH ROW EXECUTE FUNCTION analytics.reject_immutable_analytics_fact();

DROP TRIGGER IF EXISTS analytics_ingest_items_immutable ON analytics.ingest_items;
CREATE TRIGGER analytics_ingest_items_immutable
  BEFORE UPDATE OR DELETE ON analytics.ingest_items
  FOR EACH ROW EXECUTE FUNCTION analytics.reject_immutable_analytics_fact();

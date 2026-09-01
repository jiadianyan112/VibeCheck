CREATE TABLE IF NOT EXISTS community.notifications (
  notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  notification_type varchar(64) NOT NULL,
  title varchar(120) NOT NULL,
  body_summary varchar(500) NOT NULL,
  target_type varchar(64) NOT NULL,
  target_id uuid NOT NULL,
  event_id uuid REFERENCES catalog.events(event_id),
  dedup_key varchar(160) NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL,
  CHECK (notification_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  CHECK (target_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  CHECK (char_length(title) BETWEEN 1 AND 120),
  CHECK (char_length(body_summary) BETWEEN 1 AND 500),
  CHECK (char_length(dedup_key) BETWEEN 8 AND 160),
  CHECK (read_at IS NULL OR read_at >= created_at),
  UNIQUE (recipient_user_id,dedup_key)
);

CREATE INDEX IF NOT EXISTS notifications_recipient_page_idx
  ON community.notifications (
    recipient_user_id,(read_at IS NULL) DESC,created_at DESC,notification_id DESC
  );

CREATE INDEX IF NOT EXISTS notifications_recipient_unread_idx
  ON community.notifications (recipient_user_id,created_at DESC,notification_id DESC)
  WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS community.notification_read_receipts (
  recipient_user_id uuid NOT NULL REFERENCES iam.users(user_id),
  operation_id varchar(128) NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response_json jsonb NOT NULL CHECK (jsonb_typeof(response_json)='object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (recipient_user_id,operation_id)
);

CREATE OR REPLACE FUNCTION community.protect_notification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF
    NEW.notification_id IS DISTINCT FROM OLD.notification_id OR
    NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id OR
    NEW.notification_type IS DISTINCT FROM OLD.notification_type OR
    NEW.title IS DISTINCT FROM OLD.title OR
    NEW.body_summary IS DISTINCT FROM OLD.body_summary OR
    NEW.target_type IS DISTINCT FROM OLD.target_type OR
    NEW.target_id IS DISTINCT FROM OLD.target_id OR
    NEW.event_id IS DISTINCT FROM OLD.event_id OR
    NEW.dedup_key IS DISTINCT FROM OLD.dedup_key OR
    NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'NOTIFICATION_CONTENT_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  IF OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at THEN
    RAISE EXCEPTION 'NOTIFICATION_READ_FINAL' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notification_content_immutable ON community.notifications;
CREATE TRIGGER notification_content_immutable
  BEFORE UPDATE ON community.notifications
  FOR EACH ROW EXECUTE FUNCTION community.protect_notification();

DROP TRIGGER IF EXISTS notification_delete_rejected ON community.notifications;
CREATE OR REPLACE FUNCTION community.reject_notification_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'NOTIFICATION_IMMUTABLE' USING ERRCODE='55000';
END;
$$;

CREATE TRIGGER notification_delete_rejected
  BEFORE DELETE ON community.notifications
  FOR EACH ROW EXECUTE FUNCTION community.reject_notification_delete();

DROP TRIGGER IF EXISTS notification_read_receipt_immutable
  ON community.notification_read_receipts;
CREATE OR REPLACE FUNCTION community.reject_notification_read_receipt_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'NOTIFICATION_READ_RECEIPT_IMMUTABLE' USING ERRCODE='55000';
END;
$$;

CREATE TRIGGER notification_read_receipt_immutable
  BEFORE UPDATE OR DELETE ON community.notification_read_receipts
  FOR EACH ROW EXECUTE FUNCTION community.reject_notification_read_receipt_mutation();

-- Follow history is needed when an update notification is consumed after a
-- subscription has changed. Old states cannot be reconstructed; seed only
-- the currently confirmed state at its last known change time.
CREATE TABLE community.project_follow_history (
  change_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.users(user_id),
  project_id uuid NOT NULL REFERENCES catalog.projects(project_id),
  state boolean NOT NULL,
  changed_at timestamptz NOT NULL
);
CREATE INDEX project_follow_history_event_idx
  ON community.project_follow_history (project_id,user_id,changed_at DESC,change_id DESC);
CREATE INDEX project_favorites_account_page_idx
  ON community.project_interactions (user_id,updated_at DESC,project_id DESC)
  WHERE interaction_type='favorite' AND state=true;

INSERT INTO community.project_follow_history (user_id,project_id,state,changed_at)
SELECT user_id,project_id,state,updated_at FROM community.project_interactions
WHERE interaction_type='follow';

CREATE FUNCTION community.record_project_follow_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.interaction_type='follow' AND OLD.state=true THEN
      INSERT INTO community.project_follow_history (user_id,project_id,state,changed_at)
      VALUES (OLD.user_id,OLD.project_id,false,clock_timestamp());
    END IF;
  ELSIF NEW.interaction_type='follow' AND
    (TG_OP='INSERT' OR OLD.state IS DISTINCT FROM NEW.state) THEN
    INSERT INTO community.project_follow_history (user_id,project_id,state,changed_at)
    VALUES (NEW.user_id,NEW.project_id,NEW.state,NEW.updated_at);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER project_follow_history_change
  AFTER INSERT OR UPDATE OR DELETE ON community.project_interactions
  FOR EACH ROW EXECUTE FUNCTION community.record_project_follow_history();

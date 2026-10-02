ALTER TABLE community.comments
  ADD COLUMN IF NOT EXISTS entry_type varchar(16) NOT NULL DEFAULT 'discussion',
  ADD COLUMN IF NOT EXISTS experience_task text,
  ADD COLUMN IF NOT EXISTS experience_outcome text,
  ADD COLUMN IF NOT EXISTS experience_scenario text,
  ADD COLUMN IF NOT EXISTS experience_limitation text,
  ADD COLUMN IF NOT EXISTS verified_author_reply boolean NOT NULL DEFAULT false;

ALTER TABLE community.comments
  ADD CONSTRAINT comments_entry_type_valid CHECK (
    (entry_type='discussion' AND experience_task IS NULL AND experience_outcome IS NULL AND experience_scenario IS NULL AND experience_limitation IS NULL)
    OR (entry_type='experience' AND parent_comment_id IS NULL
      AND experience_task IS NOT NULL AND experience_outcome IS NOT NULL
      AND char_length(experience_task) BETWEEN 1 AND 500
      AND char_length(experience_outcome) BETWEEN 1 AND 1000
      AND (experience_scenario IS NULL OR char_length(experience_scenario) BETWEEN 1 AND 500)
      AND (experience_limitation IS NULL OR char_length(experience_limitation) BETWEEN 1 AND 500))
  );

ALTER TABLE community.comments
  ADD CONSTRAINT comments_author_reply_parent_valid CHECK (NOT verified_author_reply OR (entry_type='discussion' AND parent_comment_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS comments_public_experience_page_idx
  ON community.comments (project_id, created_at DESC, comment_id DESC)
  WHERE entry_type='experience' AND moderation_state IN ('visible','collapsed');

CREATE TABLE IF NOT EXISTS community.experience_screenshots (
  comment_id uuid NOT NULL REFERENCES community.comments(comment_id),
  media_resource_id uuid NOT NULL REFERENCES media.media_resources(media_resource_id),
  sort_order smallint NOT NULL CHECK (sort_order BETWEEN 0 AND 2),
  PRIMARY KEY (comment_id,sort_order),
  UNIQUE (comment_id,media_resource_id),
  UNIQUE (media_resource_id)
);

CREATE INDEX IF NOT EXISTS experience_screenshots_media_idx
  ON community.experience_screenshots (media_resource_id);

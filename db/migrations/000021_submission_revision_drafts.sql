CREATE UNIQUE INDEX IF NOT EXISTS submission_drafts_base_submission_uniq
  ON workflow.submission_drafts (base_submission_id)
  WHERE base_submission_id IS NOT NULL;

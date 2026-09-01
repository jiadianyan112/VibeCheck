ALTER TABLE catalog.project_versions
  DROP CONSTRAINT IF EXISTS project_versions_source_decision_type_check;

ALTER TABLE catalog.project_versions DISABLE TRIGGER project_versions_immutable;

UPDATE catalog.project_versions
SET source_decision_type = CASE source_decision_type
  WHEN 'publication_review' THEN 'review_decision'
  WHEN 'project_update_review' THEN 'review_decision'
  WHEN 'admin_fact' THEN 'admin_fact_decision'
  WHEN 'system_fact' THEN 'system_fact_decision'
  ELSE source_decision_type
END
WHERE source_decision_type IN (
  'publication_review','project_update_review','admin_fact','system_fact'
);

ALTER TABLE catalog.project_versions ENABLE TRIGGER project_versions_immutable;

ALTER TABLE catalog.project_versions
  ADD CONSTRAINT project_versions_source_decision_type_check
  CHECK (source_decision_type IN (
    'review_decision','admin_fact_decision','system_fact_decision'
  ));

CREATE TABLE IF NOT EXISTS workflow.submission_publication_receipts (
  submission_id uuid PRIMARY KEY REFERENCES workflow.submissions(submission_id),
  review_decision_id uuid NOT NULL UNIQUE REFERENCES workflow.review_decisions(review_decision_id),
  project_id uuid NOT NULL UNIQUE REFERENCES catalog.projects(project_id),
  version_id uuid NOT NULL UNIQUE REFERENCES catalog.project_versions(version_id),
  event_id uuid NOT NULL UNIQUE REFERENCES catalog.events(event_id),
  transaction_id uuid NOT NULL UNIQUE,
  response_json jsonb NOT NULL,
  published_at timestamptz NOT NULL,
  schema_version varchar(32) NOT NULL DEFAULT 'submission_publication.v1',
  CHECK (jsonb_typeof(response_json) = 'object'),
  CHECK (schema_version = 'submission_publication.v1')
);

CREATE OR REPLACE FUNCTION workflow.reject_submission_publication_receipt_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'SUBMISSION_PUBLICATION_RECEIPT_IMMUTABLE' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS submission_publication_receipt_immutable
  ON workflow.submission_publication_receipts;
CREATE TRIGGER submission_publication_receipt_immutable
  BEFORE UPDATE OR DELETE ON workflow.submission_publication_receipts
  FOR EACH ROW EXECUTE FUNCTION workflow.reject_submission_publication_receipt_mutation();

ALTER TABLE catalog.project_updates
  ADD COLUMN last_apply_error_code varchar(128);

CREATE TABLE IF NOT EXISTS workflow.project_update_application_receipts (
  update_id uuid PRIMARY KEY REFERENCES catalog.project_updates(update_id),
  review_decision_id uuid NOT NULL UNIQUE REFERENCES workflow.review_decisions(review_decision_id),
  project_id uuid NOT NULL REFERENCES catalog.projects(project_id),
  base_version_id uuid NOT NULL REFERENCES catalog.project_versions(version_id),
  version_id uuid NOT NULL UNIQUE REFERENCES catalog.project_versions(version_id),
  event_id uuid NOT NULL UNIQUE REFERENCES catalog.events(event_id),
  transaction_id uuid NOT NULL UNIQUE,
  response_json jsonb NOT NULL,
  applied_at timestamptz NOT NULL,
  schema_version varchar(32) NOT NULL DEFAULT 'project_update_application.v1',
  CHECK (jsonb_typeof(response_json)='object'),
  CHECK (schema_version='project_update_application.v1')
);

CREATE OR REPLACE FUNCTION workflow.reject_project_update_application_receipt_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PROJECT_UPDATE_APPLICATION_RECEIPT_IMMUTABLE' USING ERRCODE='55000';
END;
$$;

CREATE TRIGGER project_update_application_receipt_immutable
  BEFORE UPDATE OR DELETE ON workflow.project_update_application_receipts
  FOR EACH ROW EXECUTE FUNCTION workflow.reject_project_update_application_receipt_mutation();

CREATE OR REPLACE FUNCTION catalog.validate_review_decision_version_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  decision_record record;
  update_record record;
BEGIN
  IF NEW.source_decision_type <> 'review_decision' THEN
    RETURN NEW;
  END IF;
  SELECT decision.review_decision_id,decision.work_type,decision.target_type,decision.target_id,
         decision.decision,decision.resulting_status,decision.project_id,decision.base_version_id,
         decision.work_item_id,item.target_id AS work_target_id,item.status AS work_status,
         item.decision_ref_type,item.decision_ref_id
    INTO decision_record
    FROM workflow.review_decisions decision
    JOIN workflow.review_work_items item ON item.work_item_id=decision.work_item_id
   WHERE decision.review_decision_id=NEW.source_decision_id;
  IF decision_record.review_decision_id IS NULL
     OR decision_record.decision <> 'approve'
     OR decision_record.resulting_status <> 'approved'
     OR decision_record.work_status <> 'decided'
     OR decision_record.decision_ref_type <> 'review_decision'
     OR decision_record.decision_ref_id <> decision_record.review_decision_id
     OR decision_record.work_target_id <> decision_record.target_id THEN
    RAISE EXCEPTION 'VERSION_REVIEW_DECISION_INVALID' USING ERRCODE='23514';
  END IF;
  IF decision_record.work_type='submission' THEN
    IF decision_record.target_type<>'submission' OR decision_record.project_id IS NOT NULL
       OR decision_record.base_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'VERSION_SUBMISSION_DECISION_INVALID' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF decision_record.work_type<>'project_update' OR decision_record.target_type<>'project_update' THEN
    RAISE EXCEPTION 'VERSION_REVIEW_DECISION_TYPE_INVALID' USING ERRCODE='23514';
  END IF;
  SELECT update_id,project_id,base_version_id,review_work_item_id,status
    INTO update_record FROM catalog.project_updates
   WHERE update_id=decision_record.target_id;
  IF update_record.update_id IS NULL
     OR update_record.project_id<>NEW.project_id
     OR update_record.project_id<>decision_record.project_id
     OR update_record.base_version_id<>NEW.previous_version_id
     OR update_record.base_version_id<>decision_record.base_version_id
     OR update_record.review_work_item_id<>decision_record.work_item_id
     OR update_record.status<>'applying' THEN
    RAISE EXCEPTION 'VERSION_PROJECT_UPDATE_DECISION_INVALID' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_versions_review_decision_source_valid
  BEFORE INSERT ON catalog.project_versions
  FOR EACH ROW EXECUTE FUNCTION catalog.validate_review_decision_version_source();

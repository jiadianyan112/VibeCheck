CREATE OR REPLACE FUNCTION workflow.enforce_submission_asset_security_gate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'submitted' AND jsonb_array_length(NEW.asset_drafts_json) > 0 THEN
    RAISE EXCEPTION 'SUBMISSION_ASSET_SECURITY_RECEIPT_REQUIRED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS submission_asset_security_gate
  ON workflow.submission_drafts;
CREATE TRIGGER submission_asset_security_gate
  BEFORE UPDATE OF status,asset_drafts_json ON workflow.submission_drafts
  FOR EACH ROW EXECUTE FUNCTION workflow.enforce_submission_asset_security_gate();

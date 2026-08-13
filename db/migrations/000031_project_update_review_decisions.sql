ALTER TABLE workflow.review_decisions
  ADD CONSTRAINT review_decisions_project_update_shape_check
  CHECK (
    work_type <> 'project_update' OR (
      target_type = 'project_update'
      AND project_id IS NOT NULL
      AND base_version_id IS NOT NULL
      AND decision IN ('approve','changes_requested','reject')
      AND (
        (decision='approve' AND resulting_status='approved') OR
        (decision='changes_requested' AND resulting_status='changes_requested') OR
        (decision='reject' AND resulting_status='rejected')
      )
    )
  );

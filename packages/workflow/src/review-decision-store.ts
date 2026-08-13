import type {
  ReviewDecisionProjection,
  StoredSubmissionReviewDecisionInput,
} from './review-decision-types.js'

export interface ReviewDecisionStore {
  decideSubmission(input: StoredSubmissionReviewDecisionInput): Promise<ReviewDecisionProjection>
}

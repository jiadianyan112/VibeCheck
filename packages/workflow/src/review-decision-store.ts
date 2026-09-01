import type {
  ReviewDecisionProjection,
  StoredReviewDecisionInput,
} from './review-decision-types.js'

export interface ReviewDecisionStore {
  decideReview(input: StoredReviewDecisionInput): Promise<ReviewDecisionProjection>
}

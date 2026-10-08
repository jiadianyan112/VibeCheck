/**
 * Server-backed verification service.
 *
 * Keep this module as the stable service entry point for callers that have not
 * migrated to the more explicit verificationApi name yet. All state lives on
 * the API and every mutating method requires the authenticated session used by
 * the CSRF-protected request.
 */
export {
  verificationApi as verificationService,
  VerificationApiError,
} from './verificationApi'

export type {
  CreatorAccountLink,
  DeveloperKind,
  NewDeveloperProfileInput,
  PermissionProfileRef,
  VerificationMaterialSummary,
  VerificationRequestProjection,
  VerificationReviewerProjection,
} from './verificationApi'

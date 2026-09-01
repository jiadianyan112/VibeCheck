export { IdentityError, identityError } from './errors.js'
export {
  decryptText,
  encryptText,
  hashOtp,
  keyedHash,
  opaqueToken,
  sixDigitOtp,
  verifyHash,
} from './crypto.js'
export { canUseReturnTo, maskEmail, normalizeEmail, normalizeReturnTo } from './normalize.js'
export { permissionsFor, primaryRole } from './permissions.js'
export { ResendEmailSender } from './resend.js'
export { IdentityService, type IdentityServiceDependencies, type IdentityStore } from './service.js'
export { PendingActionService, type PendingActionServiceDependencies } from './pending-action-service.js'
export {
  PostgresPendingActionStore,
  type AccessPendingActionStoreInput,
  type CancelPendingActionStoreInput,
  type ConsumePendingActionStoreInput,
  type CreatePendingActionStoreInput,
  type PendingActionStore,
  type PendingActionStoredProjection,
  type PendingActionStoreOwner,
} from './pending-action-store.js'
export {
  PostgresIdentityStore,
  type ChallengeForVerification,
  type CompleteVerificationInput,
  type CompleteVerificationResult,
  type CreateChallengeInput,
  type CreateChallengeRecord,
  type StoredSession,
} from './store.js'
export type {
  AccountStatus,
  AuthPurpose,
  EmailOtpMessage,
  EmailSender,
  IdentityPermission,
  IdentityLinkProjection,
  IdentityRole,
  SessionProjection,
  StartChallengeCommand,
  StartChallengeResult,
  VerifyChallengeCommand,
  VerifyChallengeResult,
} from './types.js'
export {
  pendingActionTypes,
  type CancelPendingActionCommand,
  type CompletePendingActionExecutionCommand,
  type ConsumePendingActionCommand,
  type CreatePendingActionCommand,
  type GetPendingActionCommand,
  type GetPendingActionExecutionCommand,
  type PendingActionExecutionProjection,
  type PendingActionExecutionReceiptInput,
  type PendingActionPayload,
  type PendingActionProjection,
  type PendingActionStatus,
  type PendingActionSubject,
  type PendingActionType,
} from './pending-action-types.js'

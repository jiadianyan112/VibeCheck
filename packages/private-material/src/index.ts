export { PrivateMaterialError, privateMaterialError } from './errors.js'
export {
  AwsS3PrivateMaterialStorage,
  type AwsS3PrivateMaterialConfig,
  type S3PrivateMaterialClient,
  type S3PrivateMaterialPresigner,
} from './aws-s3-storage.js'
export {
  PrivateMaterialService,
  createPrivateMaterialStorageKeyResolver,
  type PrivateMaterialCryptoConfig,
  type PrivateMaterialStorageKeyResolver,
  type PrivateMaterialStorePort,
} from './service.js'
export { PostgresPrivateMaterialStore, applicantSummary, type StoredMaterial } from './store.js'
export {
  PostgresPrivateMaterialScanStore,
  PrivateMaterialScanProcessor,
  type PrivateMaterialScanStorePort,
} from './scan-processor.js'
export { PostgresPrivateMaterialAccessRevoker } from './access-revoker.js'
export {
  verificationMaterialMimeTypes,
  type ApplicantMaterialSummary,
  type CompleteMaterialCommand,
  type CompleteMaterialProjection,
  type GetMaterialCommand,
  type MaterialUploadInspection,
  type PrepareMaterialCommand,
  type PrepareMaterialProjection,
  type PrivateMaterialStorage,
  type PrivateMaterialScanResult,
  type PrivateMaterialScanSource,
  type RevokeMaterialCommand,
  type RevokeMaterialProjection,
  type VerificationMaterialMime,
  type ReviewerMaterialCommand,
  type VerificationMaterialReviewerProjection,
  type CreateMaterialReadGrantCommand,
  type MaterialReadGrantProjection,
  type RedeemMaterialReadGrantCommand,
  type MaterialReadRedemptionProjection,
} from './types.js'

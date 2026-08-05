export { adminService } from './adminService'
export { comparisonService } from './comparisonService'
export { communityService } from './communityService'
export { intentService, parseIntent, type IntentParseResult } from './intentService'
export { notificationService } from './notificationService'
export { projectService, type ProjectBundle } from './projectService'
export { projectUpdateService } from './projectUpdateService'
export {
  clone,
  configureServiceRuntime,
  runService,
  serviceScenarioIds,
  type ServiceOptions,
  type ServiceScenarioId,
} from './runtime'
export {
  searchService,
  type SearchFilters,
  type SearchHit,
  type SearchResponse,
} from './searchService'
export {
  normalizeSubmissionUrl,
  submissionService,
  type ExtractionResult,
  type UrlCheckItem,
  type UrlCheckResult,
} from './submissionService'
export { verificationService } from './verificationService'
export type { ServiceError, ServiceErrorKind, ServiceResult } from './result'

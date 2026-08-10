export { CatalogError, catalogError } from './errors.js'
export { CatalogService, type CatalogServiceDependencies } from './service.js'
export {
  PostgresCatalogStore,
  type CatalogStore,
  type ListStoredProjectsInput,
  type StoredCreator,
  type StoredProject,
} from './store.js'
export {
  categoryIds,
  schemaVersions,
  type AssetProjection,
  type CategoryId,
  type CategorySchemaVersion,
  type CreatorProjection,
  type CreatorSummary,
  type EventProjection,
  type KnowledgeState,
  type LearningSchemaV1,
  type ListProjectsInput,
  type PortfolioSchemaV1,
  type ProjectCardProjection,
  type ProjectCoreSnapshot,
  type ProjectListProjection,
  type ProjectProjection,
  type ProjectSnapshot,
} from './types.js'
export { parseProjectSnapshot } from './validation.js'

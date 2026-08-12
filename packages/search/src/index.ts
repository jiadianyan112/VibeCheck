export { SearchCrypto, type EncryptedQuery } from './crypto.js'
export { SearchError, searchError } from './errors.js'
export { SearchService, type SearchServiceDependencies } from './service.js'
export {
  PostgresSearchStore,
  type CreateStoredSearchInput,
  type ExistingStoredSearchInput,
  type QueryAccessResult,
  type SearchStore,
  type StoredQuerySnapshot,
  type StoredResultItem,
  type StoredSearchExecution,
} from './store.js'
export {
  searchModes,
  searchSorts,
  type SearchCommand,
  type SearchFilters,
  type SearchMatchReason,
  type SearchMode,
  type SearchProjection,
  type SearchResultGroup,
  type SearchResultItem,
  type SearchServiceConfig,
  type SearchSort,
  type SearchSubject,
} from './types.js'

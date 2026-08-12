import { createHash, createHmac } from 'node:crypto'

import type { ComparisonConfig } from '@vibecheck/config'

import { comparisonError } from './errors.js'
import type { ComparisonStore } from './store-port.js'
import type {
  ComparisonProgressProjection,
  ComparisonProjection,
  PutComparisonCommand,
  ComparisonMutationProjection,
  ComparisonSubject,
  RecordComparisonDimensionCommand,
  SetComparisonSavedCommand,
} from './types.js'

export interface ComparisonServiceDependencies {
  readonly store: ComparisonStore
  readonly config: ComparisonConfig
  readonly now?: () => Date
}

export class ComparisonService {
  private readonly now: () => Date

  constructor(private readonly dependencies: ComparisonServiceDependencies) {
    if (!dependencies.config.enabled) throw new Error('COMPARISON_SERVICE_DISABLED')
    if (
      dependencies.config.subjectHashPepper.length < 32 ||
      dependencies.config.anonymousTtlSeconds < 3_600 ||
      dependencies.config.maximumVisibleMsPerEvent < 1_000
    ) throw new Error('COMPARISON_CONFIG_INVALID')
    this.now = dependencies.now ?? (() => new Date())
  }

  getComparison(
    comparisonId: string,
    subject: ComparisonSubject,
  ): Promise<ComparisonProjection> {
    const owner = this.owner(subject)
    return this.dependencies.store.getComparison({
      comparisonId: this.uuid(comparisonId, 'COMPARISON_ID_INVALID'),
      ...owner,
      now: this.now(),
    })
  }

  putComparison(command: PutComparisonCommand): Promise<ComparisonMutationProjection> {
    const comparisonId = this.uuid(command.comparisonId, 'COMPARISON_ID_INVALID')
    const clientRequestId = this.uuid(command.clientRequestId, 'CLIENT_REQUEST_ID_INVALID')
    if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0) {
      throw comparisonError('COMPARISON_VERSION_INVALID', 422)
    }
    if (!Array.isArray(command.orderedProjectIds) || command.orderedProjectIds.length > 5) {
      throw comparisonError('COMPARISON_ITEM_LIMIT_EXCEEDED', 409, false, undefined, {
        maximum_count: 5,
        requested_count: command.orderedProjectIds.length,
      })
    }
    const orderedProjectIds = Object.freeze(command.orderedProjectIds.map((projectId) => (
      this.uuid(projectId, 'PROJECT_ID_INVALID')
    )))
    if (new Set(orderedProjectIds).size !== orderedProjectIds.length) {
      throw comparisonError('COMPARISON_PROJECT_DUPLICATED', 422)
    }
    if (command.expectedVersion === 0 && orderedProjectIds.length === 0) {
      throw comparisonError('COMPARISON_CREATE_REQUIRES_PROJECT', 422)
    }
    const owner = this.owner(command.subject)
    const now = this.now()
    const requestHash = createHash('sha256').update(JSON.stringify({
      comparison_id: comparisonId,
      ordered_project_ids: orderedProjectIds,
      expected_version: command.expectedVersion,
    })).digest('hex')
    return this.dependencies.store.putComparison({
      comparisonId,
      orderedProjectIds,
      expectedVersion: command.expectedVersion,
      clientRequestId,
      requestHash,
      ...owner,
      anonymousExpiresAt: new Date(
        now.getTime() + this.dependencies.config.anonymousTtlSeconds * 1_000,
      ),
      now,
    })
  }

  setSaved(command: SetComparisonSavedCommand): Promise<ComparisonProjection> {
    if (command.subject.kind !== 'user') throw comparisonError('AUTHENTICATION_REQUIRED', 401)
    if (!Number.isSafeInteger(command.comparisonVersion) || command.comparisonVersion < 1) {
      throw comparisonError('COMPARISON_VERSION_INVALID', 422)
    }
    return this.dependencies.store.setSaved({
      comparisonId: this.uuid(command.comparisonId, 'COMPARISON_ID_INVALID'),
      comparisonVersion: command.comparisonVersion,
      state: command.state,
      requestId: this.requestId(command.requestId),
      ...this.owner(command.subject),
      now: this.now(),
    })
  }

  recordDimensionProgress(
    command: RecordComparisonDimensionCommand,
  ): Promise<ComparisonProgressProjection> {
    if (
      !Number.isSafeInteger(command.comparisonVersion) || command.comparisonVersion < 1 ||
      !Number.isSafeInteger(command.visibleMs) || command.visibleMs < 1_000 ||
      command.visibleMs > this.dependencies.config.maximumVisibleMsPerEvent ||
      !Number.isSafeInteger(command.viewSequence) || command.viewSequence < 1
    ) throw comparisonError('COMPARISON_PROGRESS_INVALID', 422)
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(command.dimensionGroup)) {
      throw comparisonError('COMPARISON_DIMENSION_INVALID', 422)
    }
    const occurredAt = new Date(command.occurredAt)
    const now = this.now()
    if (
      Number.isNaN(occurredAt.getTime()) ||
      occurredAt.getTime() > now.getTime() + 5 * 60_000 ||
      occurredAt.getTime() < now.getTime() - 7 * 86_400_000
    ) throw comparisonError('COMPARISON_PROGRESS_TIME_INVALID', 422)
    return this.dependencies.store.recordDimensionProgress({
      eventId: this.uuid(command.eventId, 'EVENT_ID_INVALID'),
      comparisonId: this.uuid(command.comparisonId, 'COMPARISON_ID_INVALID'),
      comparisonVersion: command.comparisonVersion,
      dimensionGroup: command.dimensionGroup,
      visibleMs: command.visibleMs,
      viewSequence: command.viewSequence,
      occurredAt,
      ...this.owner(command.subject),
      now,
    })
  }

  private owner(subject: ComparisonSubject) {
    const id = this.uuid(subject.id, 'COMPARISON_SUBJECT_INVALID')
    if (subject.kind !== 'anonymous' && subject.kind !== 'user') {
      throw comparisonError('COMPARISON_SUBJECT_INVALID', 403)
    }
    return Object.freeze({
      subject: Object.freeze({ kind: subject.kind, id }),
      subjectHash: createHmac('sha256', this.dependencies.config.subjectHashPepper)
        .update(`${subject.kind}:${id}`, 'utf8')
        .digest(),
    })
  }

  private uuid(value: string, code: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw comparisonError(code, 422)
    }
    return value.toLowerCase()
  }

  private requestId(value: string): string {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(value)) throw comparisonError('REQUEST_ID_INVALID', 422)
    return value
  }
}

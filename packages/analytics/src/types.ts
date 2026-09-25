export interface AnalyticsSubject {
  readonly kind: 'anonymous' | 'user'
  readonly id: string
}

export interface AnalyticsBrowserContext {
  readonly subject: AnalyticsSubject
  readonly bindingMaterial: string
}

export interface AnalyticsIdentityAttestation {
  readonly metricSubjectId: string
  readonly subjectRefHash: Buffer
  readonly bridgeVersion: number
}

export interface ComparisonDimensionViewedPayload {
  readonly comparison_id: string
  readonly comparison_version: number
  readonly dimension_group: string
  readonly visible_ms: number
  readonly project_count: number
  readonly view_sequence: number
  readonly interaction_type?: string
}

export interface ValidatedClientAnalyticsEvent {
  readonly eventId: string
  readonly eventName: 'comparison_dimension_viewed'
  readonly eventVersion: 1
  readonly occurredAt: Date
  readonly appVersion: string
  readonly pageId: 'P09'
  readonly sourcePage: string | null
  readonly requestId: string | null
  readonly payload: ComparisonDimensionViewedPayload
}

export interface AnalyticsItemReceipt {
  readonly event_id: string
  readonly status: 'accepted' | 'deduplicated' | 'rejected'
  readonly error_code?: string
}

export interface AnalyticsBatchReceipt {
  readonly receipt_id: string
  readonly items: readonly AnalyticsItemReceipt[]
}

export interface IngestClientBatchCommand {
  readonly body: Readonly<Record<string, unknown>>
  readonly sessionHeader: string | null
  readonly context: AnalyticsBrowserContext
  readonly environment: 'development' | 'test' | 'production'
}

export interface RecordComparisonDimensionInput {
  readonly eventId: string
  readonly comparisonId: string
  readonly comparisonVersion: number
  readonly dimensionGroup: string
  readonly visibleMs: number
  readonly projectCount: number
  readonly viewSequence: number
  readonly occurredAt: string
  readonly subject: AnalyticsSubject
}

export interface AnalyticsEventHandler {
  recordComparisonDimension(input: RecordComparisonDimensionInput): Promise<void>
}

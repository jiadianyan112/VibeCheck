import type { RuntimeEnvironment } from '@vibecheck/config'

import type {
  AnalyticsItemReceipt,
  AnalyticsSubject,
  ValidatedClientAnalyticsEvent,
} from './types.js'

export interface ExistingAnalyticsEvent {
  readonly payloadHash: string
}

export interface PersistAnalyticsEventInput {
  readonly event: ValidatedClientAnalyticsEvent
  readonly payloadHash: string
  readonly receivedAt: Date
  readonly environment: RuntimeEnvironment
  readonly consentState: 'granted' | 'not_required'
  readonly sessionHash: Buffer
  readonly metricSubjectId: string
  readonly subjectRefHash: Buffer
  readonly subject: AnalyticsSubject
  readonly bridgeVersion: number
  readonly clockSkewFlag: boolean
}

export interface PersistAnalyticsReceiptInput {
  readonly receiptId: string
  readonly batchHash: string
  readonly sessionHash: Buffer
  readonly items: readonly AnalyticsItemReceipt[]
  readonly itemPayloadHashes: readonly string[]
  readonly createdAt: Date
}

export interface AnalyticsStore {
  getEvent(eventId: string): Promise<ExistingAnalyticsEvent | null>
  persistEvent(input: PersistAnalyticsEventInput): Promise<{
    readonly inserted: boolean
    readonly payloadHash: string
  }>
  persistReceipt(input: PersistAnalyticsReceiptInput): Promise<void>
}

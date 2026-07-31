import {
  evidenceId,
  type EvidenceId,
  type FieldFact,
  type FreshnessStatus,
} from '../types'

interface FactOptions {
  evidenceKey: string
  lastVerifiedAt: string | null
  freshness?: FreshnessStatus
}

function metadata({
  evidenceKey,
  lastVerifiedAt,
  freshness = 'valid',
}: FactOptions) {
  return {
    evidenceIds: [evidenceId(evidenceKey)] as EvidenceId[],
    freshness,
    lastVerifiedAt,
    disputeStatus: 'none' as const,
    confidence: null,
  }
}

export function knownFact<T>(value: T, options: FactOptions): FieldFact<T> {
  return {
    state: 'known',
    value,
    ...metadata(options),
  }
}

export function unknownFact<T>(reason: string, options: FactOptions): FieldFact<T> {
  return {
    state: 'unknown',
    reason,
    ...metadata(options),
  }
}

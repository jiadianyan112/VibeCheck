import {
  accessStatuses,
  canBeProducedByTechnicalCheck,
  isTerminalAccessStatus,
  reviewStatuses,
} from './domain'

describe('domain status boundaries', () => {
  it('keeps terminal lifecycle states out of technical checks', () => {
    expect(isTerminalAccessStatus('paused')).toBe(true)
    expect(isTerminalAccessStatus('ended')).toBe(true)
    expect(canBeProducedByTechnicalCheck('paused')).toBe(false)
    expect(canBeProducedByTechnicalCheck('ended')).toBe(false)
  })

  it('allows technical checks to produce only observable access states', () => {
    expect(canBeProducedByTechnicalCheck('normal')).toBe(true)
    expect(canBeProducedByTechnicalCheck('pending_recheck')).toBe(true)
    expect(canBeProducedByTechnicalCheck('link_unavailable')).toBe(true)
  })

  it('exports closed status vocabularies', () => {
    expect(accessStatuses).toHaveLength(10)
    expect(reviewStatuses).toContain('published_platform')
    expect(reviewStatuses).toContain('published_author')
  })
})

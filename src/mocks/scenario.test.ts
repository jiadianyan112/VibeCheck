import { prototypeScenarioIds, prototypeScenarios, resolveServiceScenario } from './scenario'

describe('prototype scenario catalog', () => {
  it('indexes every required state once with a stable direct URL', () => {
    expect(prototypeScenarios.map(({ id }) => id)).toEqual(prototypeScenarioIds.filter((id) => id !== 'default'))
    expect(new Set(prototypeScenarios.map(({ path }) => path)).size).toBe(prototypeScenarios.length)
    expect(prototypeScenarios.every(({ path }) => path.startsWith('/') && path.includes('prototypeScenario='))).toBe(true)
  })

  it('maps unified parameters locally while preserving legacy service parameters', () => {
    expect(resolveServiceScenario(new URLSearchParams('prototypeScenario=search_insufficient'), 'default')).toBe('sparse_results')
    expect(resolveServiceScenario(new URLSearchParams('prototypeScenario=service_error'), 'default')).toBe('service_error')
    expect(resolveServiceScenario(new URLSearchParams('scenario=network_error'), 'default')).toBe('network_error')
    expect(resolveServiceScenario(new URLSearchParams('scenario=question_generation'), 'default')).toBe('default')
  })
})

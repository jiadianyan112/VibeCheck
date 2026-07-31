import { createContext, useContext, useMemo, type PropsWithChildren } from 'react'
import { defaultScenario, type PrototypeScenario } from '../mocks'

interface PrototypeState {
  scenario: PrototypeScenario
}

const PrototypeStateContext = createContext<PrototypeState | null>(null)

export function PrototypeStateProvider({ children }: PropsWithChildren) {
  const value = useMemo<PrototypeState>(
    () => ({ scenario: defaultScenario }),
    [],
  )

  return (
    <PrototypeStateContext.Provider value={value}>
      {children}
    </PrototypeStateContext.Provider>
  )
}

export function usePrototypeState() {
  const context = useContext(PrototypeStateContext)

  if (!context) {
    throw new Error('usePrototypeState must be used inside PrototypeStateProvider')
  }

  return context
}

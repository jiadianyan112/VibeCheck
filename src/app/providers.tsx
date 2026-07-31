import type { PropsWithChildren } from 'react'
import { PrototypeDebugPanel } from '../components'
import { AppStateProvider } from '../state'

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <AppStateProvider>
      {children}
      <PrototypeDebugPanel />
    </AppStateProvider>
  )
}

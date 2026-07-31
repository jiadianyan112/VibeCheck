import type { PropsWithChildren } from 'react'
import { PrototypeStateProvider } from '../state'

export function AppProviders({ children }: PropsWithChildren) {
  return <PrototypeStateProvider>{children}</PrototypeStateProvider>
}

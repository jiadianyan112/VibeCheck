import type { PropsWithChildren } from 'react'
import { ErrorBoundary, ToastProvider } from '../components'
import { AuthGateProvider } from '../features'
import { AppStateProvider } from '../state'

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ErrorBoundary>
      <AppStateProvider>
        <ToastProvider>
          <AuthGateProvider>
            {children}
          </AuthGateProvider>
        </ToastProvider>
      </AppStateProvider>
    </ErrorBoundary>
  )
}

import type { PropsWithChildren } from 'react'
import { ErrorBoundary, ToastProvider } from '../components'
import { AuthGateProvider, AuthSessionProvider } from '../features'
import { AppStateProvider } from '../state'

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ErrorBoundary>
      <AppStateProvider>
        <ToastProvider>
          <AuthSessionProvider>
            <AuthGateProvider>
              {children}
            </AuthGateProvider>
          </AuthSessionProvider>
        </ToastProvider>
      </AppStateProvider>
    </ErrorBoundary>
  )
}

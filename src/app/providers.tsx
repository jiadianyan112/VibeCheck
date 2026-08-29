import type { PropsWithChildren } from 'react'
import { ErrorBoundary, ToastProvider } from '../components'
import { AuthSessionProvider } from '../features'
import { AppStateProvider } from '../state'

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ErrorBoundary>
      <AppStateProvider>
        <ToastProvider>
          <AuthSessionProvider>
            {children}
          </AuthSessionProvider>
        </ToastProvider>
      </AppStateProvider>
    </ErrorBoundary>
  )
}

import type { PropsWithChildren } from 'react'
import { ErrorBoundary, ToastProvider } from '../components'
import { AuthSessionProvider } from '../features'
import { ServerNotificationProvider } from '../features/notifications/ServerNotificationContext'
import { AppStateProvider } from '../state'

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ErrorBoundary>
      <AppStateProvider>
        <ToastProvider>
          <AuthSessionProvider>
            <ServerNotificationProvider>{children}</ServerNotificationProvider>
          </AuthSessionProvider>
        </ToastProvider>
      </AppStateProvider>
    </ErrorBoundary>
  )
}

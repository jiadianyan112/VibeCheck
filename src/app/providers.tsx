import type { PropsWithChildren } from 'react'
import { ErrorBoundary, ToastProvider } from '../components'
import { AuthSessionProvider } from '../features'
import { ServerNotificationProvider } from '../features/notifications/ServerNotificationContext'
import { AppStateProvider } from '../state'
import { ProjectInteractionProvider } from '../features/interactions/ProjectInteractionContext'

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ErrorBoundary>
      <AppStateProvider>
        <ToastProvider>
          <AuthSessionProvider>
            <ProjectInteractionProvider><ServerNotificationProvider>{children}</ServerNotificationProvider></ProjectInteractionProvider>
          </AuthSessionProvider>
        </ToastProvider>
      </AppStateProvider>
    </ErrorBoundary>
  )
}

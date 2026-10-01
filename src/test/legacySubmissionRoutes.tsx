import type { RouteObject } from 'react-router-dom'
import { appRoutes } from '../app/router'
import { SubmitEntryPage } from '../pages/SubmitEntryPage'
import { SubmitFormPage } from '../pages/SubmitFormPage'

// Historical editor contract coverage remains explicit and independent of the
// public composer routes. Current publishing is covered by publish-composer e2e.
function legacy(routes: RouteObject[]): RouteObject[] {
  return routes.map(route => ({
    ...route,
    ...(route.path === '/submit' ? { element: <SubmitEntryPage /> } : {}),
    ...(route.path === '/submit/new' ? { element: <SubmitFormPage /> } : {}),
    ...(route.children ? { children: legacy(route.children) } : {}),
  } as RouteObject))
}
export const legacySubmissionRoutes = legacy(appRoutes)

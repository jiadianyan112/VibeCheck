import {
  Navigate,
  createBrowserRouter,
  type RouteObject,
} from 'react-router-dom'
import { routeCatalog } from './routeCatalog'
import { NotFoundPage, RoutePlaceholderPage, StyleSandboxPage } from '../pages'

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <Navigate to="/projects" replace />,
  },
  ...routeCatalog.map((route) => ({
    path: route.path,
    element: <RoutePlaceholderPage route={route} />,
  })),
  {
    path: '/__sandbox',
    element: <StyleSandboxPage />,
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
]

export const router = createBrowserRouter(appRoutes)

import {
  Navigate,
  createBrowserRouter,
  type RouteObject,
} from 'react-router-dom'
import { routeCatalog } from './routeCatalog'
import { NotFoundPage, ProjectsHomePage, RoutePlaceholderPage, StyleSandboxPage } from '../pages'
import { AdminLayout, FrontstageLayout } from '../components'

const frontstageRoutes = routeCatalog
  .filter((route) => route.area === 'frontstage')
  .map((route) => ({
    path: route.path,
    element: route.id === 'P01' ? <ProjectsHomePage /> : <RoutePlaceholderPage route={route} />,
  }))

const adminRoutes = routeCatalog
  .filter((route) => route.area === 'admin')
  .map((route) => ({
    path: route.path,
    element: <RoutePlaceholderPage route={route} />,
  }))

export const appRoutes: RouteObject[] = [
  {
    element: <FrontstageLayout />,
    children: [
      {
        path: '/',
        element: <Navigate to="/projects" replace />,
      },
      ...frontstageRoutes,
      {
        path: '*',
        element: <NotFoundPage />,
      },
    ],
  },
  {
    element: <AdminLayout />,
    children: adminRoutes,
  },
  {
    path: '/__sandbox',
    element: <StyleSandboxPage />,
  },
]

export const router = createBrowserRouter(appRoutes)

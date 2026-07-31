import {
  Navigate,
  createBrowserRouter,
  type RouteObject,
} from 'react-router-dom'
import { routeCatalog } from './routeCatalog'
import { AboutPage, ActivityPage, CategoriesPage, CategoryDetailPage, DiscoverPage, DiscoverResultPage, NotFoundPage, ProjectDetailPage, ProjectsHomePage, RoutePlaceholderPage, SearchPage, StyleSandboxPage } from '../pages'
import { AdminLayout, FrontstageLayout } from '../components'

const frontstageRoutes = routeCatalog
  .filter((route) => route.area === 'frontstage')
  .map((route) => ({
    path: route.path,
    element: route.id === 'P01' ? <ProjectsHomePage /> : route.id === 'P02' ? <CategoriesPage /> : route.id === 'P03' ? <CategoryDetailPage /> : route.id === 'P04' ? <ActivityPage /> : route.id === 'P05' ? <SearchPage /> : route.id === 'P06' ? <DiscoverPage /> : route.id === 'P07' ? <DiscoverResultPage /> : route.id === 'P08' ? <ProjectDetailPage /> : route.id === 'P18' ? <AboutPage /> : <RoutePlaceholderPage route={route} />,
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

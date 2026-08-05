import {
  Navigate,
  createBrowserRouter,
  type RouteObject,
} from 'react-router-dom'
import { routeCatalog } from './routeCatalog'
import { AboutPage, ActivityPage, AdminAuthorVerificationPage, AdminDashboardPage, AdminDuplicatesPage, AdminProjectEditorPage, AdminProjectsPage, AdminReviewsPage, AdminStatusMonitorPage, AuthorVerificationPage, AuthPage, CategoriesPage, CategoryDetailPage, CompareSessionPage, CreatorProfilePage, DiscoverPage, DiscoverResultPage, NotFoundPage, NotificationsPage, PersonalCenterPage, ProjectDetailPage, ProjectUpdatePage, ProjectsHomePage, RoutePlaceholderPage, SearchPage, StyleSandboxPage, SubmitEntryPage, SubmitFormPage } from '../pages'
import { AdminLayout, FrontstageLayout } from '../components'
import { AuthenticatedRoute, StaffRoute } from '../features'

const frontstageRoutes = routeCatalog
  .filter((route) => route.area === 'frontstage')
  .map((route) => {
    const page = route.id === 'P01' ? <ProjectsHomePage /> : route.id === 'P02' ? <CategoriesPage /> : route.id === 'P03' ? <CategoryDetailPage /> : route.id === 'P04' ? <ActivityPage /> : route.id === 'P05' ? <SearchPage /> : route.id === 'P06' ? <DiscoverPage /> : route.id === 'P07' ? <DiscoverResultPage /> : route.id === 'P08' ? <ProjectDetailPage /> : route.id === 'P09' ? <CompareSessionPage /> : route.id === 'P10' ? <SubmitEntryPage /> : route.id === 'P11' ? <SubmitFormPage /> : route.id === 'P12' ? <AuthorVerificationPage /> : route.id === 'P13' ? <ProjectUpdatePage /> : route.id === 'P14' ? <CreatorProfilePage /> : route.id === 'P15' ? <PersonalCenterPage /> : route.id === 'P16' ? <NotificationsPage /> : route.id === 'P17' ? <AuthPage /> : route.id === 'P18' ? <AboutPage /> : <RoutePlaceholderPage route={route} />
    return {
      path: route.path,
      element: route.id === 'P15' || route.id === 'P16' ? <AuthenticatedRoute>{page}</AuthenticatedRoute> : page,
    }
  })

const adminRoutes = routeCatalog
  .filter((route) => route.area === 'admin')
  .map((route) => ({
    path: route.path,
    element: route.id === 'A01' ? <AdminDashboardPage /> : route.id === 'A02' ? <AdminProjectsPage /> : route.id === 'A03' ? <AdminProjectEditorPage /> : route.id === 'A04' ? <AdminDuplicatesPage /> : route.id === 'A05' ? <AdminReviewsPage /> : route.id === 'A06' ? <AdminAuthorVerificationPage /> : route.id === 'A09' ? <AdminStatusMonitorPage /> : <RoutePlaceholderPage route={route} />,
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
    element: <StaffRoute><AdminLayout /></StaffRoute>,
    children: adminRoutes,
  },
  {
    path: '/__sandbox',
    element: <StyleSandboxPage />,
  },
]

export const router = createBrowserRouter(appRoutes)

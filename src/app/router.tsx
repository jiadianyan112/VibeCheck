import { createBrowserRouter } from 'react-router-dom'
import { StyleSandboxPage, WorkspacePage } from '../pages'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <WorkspacePage />,
  },
  {
    path: '/__sandbox',
    element: <StyleSandboxPage />,
  },
])

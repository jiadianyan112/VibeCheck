import { createBrowserRouter } from 'react-router-dom'
import { WorkspacePage } from '../pages'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <WorkspacePage />,
  },
])

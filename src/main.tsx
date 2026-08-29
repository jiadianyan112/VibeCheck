import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import './styles/global.css'
import './styles/highfi-foundation.css'
import './styles/highfi-components.css'
import './styles/highfi-home.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Missing #root application mount point')
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

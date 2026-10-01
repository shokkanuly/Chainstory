import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import AppRoutes from './AppRoutes.tsx'
import { SpotlightTracker } from './components/motion/pointer.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SpotlightTracker />
      <AppRoutes />
    </BrowserRouter>
  </StrictMode>,
)

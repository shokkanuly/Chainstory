import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import TripwirePage from './pages/Tripwire.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TripwirePage />
  </StrictMode>,
)

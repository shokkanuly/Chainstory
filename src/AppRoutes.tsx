import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import Landing from './pages/Landing.tsx'
import Workspace from './pages/Workspace.tsx'

// The v2 shell carries its own fonts and token sheet, so it is code-split to
// keep them off the critical path of the main app.
const PrototypeApp = lazy(() => import('./prototype/PrototypeApp.tsx'))

export default function AppRoutes() {
  return (
    <Routes>
      {/* Marketing */}
      <Route path="/" element={<Landing />} />
      {/* The analyser, on its own page */}
      <Route path="/app" element={<Workspace />} />
      <Route
        path="/v2"
        element={
          <Suspense fallback={<div style={{ minHeight: '100dvh', background: '#0a0a0c' }} />}>
            <PrototypeApp />
          </Suspense>
        }
      />
      <Route path="*" element={<Landing />} />
    </Routes>
  )
}

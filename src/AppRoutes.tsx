import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import Landing from './pages/Landing.tsx'
import Workspace from './pages/Workspace.tsx'

// The v2 shell carries its own fonts and token sheet, so it is code-split to
// keep them off the critical path of the main app.
const PrototypeApp = lazy(() => import('./prototype/PrototypeApp.tsx'))
// The incident replay runs an in-browser EVM; keep it off every other page's bundle.
const TripwirePage = lazy(() => import('./pages/Tripwire.tsx'))
const TripwireOperations = lazy(() => import('./pages/TripwireOperations.tsx'))
const CheckPage = lazy(() => import('./pages/Check.tsx'))

export default function AppRoutes() {
  return (
    <Routes>
      {/* Marketing */}
      <Route path="/" element={<Landing />} />
      {/* The analyser, on its own page */}
      <Route path="/app" element={<Workspace />} />
      {/* Tripwire: the incident replay */}
      <Route
        path="/tripwire"
        element={
          <Suspense fallback={<div style={{ minHeight: '100dvh' }} />}>
            <TripwirePage />
          </Suspense>
        }
      />
      {/* Retold: check a pending transaction before signing it */}
      <Route path="/tripwire/operations" element={<Suspense fallback={<div style={{ minHeight: '100dvh' }} />}><TripwireOperations /></Suspense>} />
      <Route
        path="/check"
        element={
          <Suspense fallback={<div style={{ minHeight: '100dvh' }} />}>
            <CheckPage />
          </Suspense>
        }
      />
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

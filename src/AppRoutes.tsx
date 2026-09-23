import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import App from './App.tsx'

// The v2 shell carries its own fonts and token sheet, so it is code-split to
// keep them off the critical path of the current UI.
const PrototypeApp = lazy(() => import('./prototype/PrototypeApp.tsx'))

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<App />} />
      <Route
        path="/v2"
        element={
          <Suspense fallback={<div style={{ minHeight: '100dvh', background: '#0a0a0c' }} />}>
            <PrototypeApp />
          </Suspense>
        }
      />
      <Route path="*" element={<App />} />
    </Routes>
  )
}

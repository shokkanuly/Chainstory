import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Landing from './pages/Landing.tsx';
import NotFound from './pages/NotFound.tsx';

const TripwirePage = lazy(() => import('./pages/Tripwire.tsx'));
const TripwireOperations = lazy(() => import('./pages/TripwireOperations.tsx'));

function RouteMetadata() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    document.title = pathname === '/tripwire/operations' ? 'Operations · Tripwire' : pathname === '/tripwire' ? 'Incident replay · Tripwire' : pathname === '/' ? 'Tripwire — verify before release' : 'Page not found · Tripwire';
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

function LoadingPage() {
  return <main className="flex min-h-[100dvh] items-center justify-center" role="status"><p className="font-mono text-sm text-muted-foreground">Loading Tripwire…</p></main>;
}

export default function AppRoutes() {
  return <>
    <RouteMetadata />
    <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-background focus:p-3">Skip to content</a>
    <Suspense fallback={<LoadingPage />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/tripwire" element={<TripwirePage />} />
        <Route path="/tripwire/operations" element={<TripwireOperations />} />
        <Route path="/app" element={<Navigate to="/tripwire/operations" replace />} />
        <Route path="/check" element={<Navigate to="/" replace />} />
        <Route path="/v2" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  </>;
}

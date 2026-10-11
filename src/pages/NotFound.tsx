import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'

export default function NotFound() {
  return (
    <div><Navbar /><main id="main-content" className="flex min-h-[75dvh] items-center justify-center px-6 pt-20 text-foreground">
      <div className="space-y-4 text-center">
        <h1 className="text-4xl font-semibold">404</h1>
        <p className="text-muted-foreground">This page could not be found.</p>
        <Link
          to="/"
          className="inline-flex rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent"
        >
          Back to Tripwire
        </Link>
      </div>
    </main><Footer /></div>
  )
}
